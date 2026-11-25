# Modelo de datos

**Propuesto, no implementado.** Una compra contiene un producto y cantidad; puede
conservar varios intentos de pago, solo uno activo. Ver [flujo](checkout-flow.md)
y [API](api-contract.md).

## Relaciones

```mermaid
erDiagram
    PRODUCTS ||--o{ CHECKOUTS : selected_in
    CHECKOUT_SESSIONS ||--o{ CHECKOUTS : owns
    CUSTOMERS |o--|| CHECKOUTS : identifies_buyer
    CHECKOUTS ||--o{ TRANSACTIONS : has_attempts
    PRODUCTS ||--o{ INVENTORY_RESERVATIONS : reserved_as
    TRANSACTIONS ||--|| INVENTORY_RESERVATIONS : holds
    CHECKOUTS ||--o| DELIVERIES : fulfilled_by
    TRANSACTIONS ||--o| DELIVERIES : authorizes
```

## Convenciones

UUID v4 como PK; todas las tablas tienen `id` y `created_at timestamptz`.
Las filas mutables tienen `updated_at`. Fechas API UTC ISO 8601, FK con
ON DELETE RESTRICT. En las tablas, `?` indica NULL permitido; el resto es
obligatorio. Estados como varchar con CHECK. Los IDs del proveedor son opacos.

Importes integer en **centavos**, moneda COP. Cada importe y total calculado
está entre 0 y 2 000 000 000; precio y total deben ser positivos. El límite cabe
exactamente en PostgreSQL integer y TypeScript number. Multiplicar/sumar con
bigint transitorio o comprobaciones de entero seguro antes de convertir; no
serializar bigint ni usar float para dinero. Cantidad 1..99. El rango efectivo
además respetará límites de UAT, todavía por verificar.

## Tablas relevantes

### Catálogo y compra

| Tabla / propietario            | Campos relevantes                                                                                                                                        | Integridad                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `products` / Catalog           | sku varchar(64), name varchar(120), description text, image_url varchar(2048), unit_price_cents integer, currency char(3), stock integer, active boolean | UNIQUE sku; stock 0..1000000; precio positivo; currency=COP; imagen HTTPS controlada         |
| `checkout_sessions` / Checkout | token_digest bytea, expires_at timestamptz                                                                                                               | UNIQUE token_digest; digest de token aleatorio de 256 bits; cookie, no bearer en claro en DB |
| `customers` / Checkout         | full_name varchar(120), email varchar(254), phone varchar(16)                                                                                            | Cliente específico de una compra; no identidad global ni UNIQUE email                        |
| `checkouts` / Checkout         | session_id FK, product_id FK, customer_id FK ?, quantity smallint, delivery_draft jsonb ?, status varchar(32)                                            | UNIQUE customer_id; estados DRAFT/PAYMENT_PENDING/PAID; índice session_id                    |

El comprador y destino se completan antes de crear un intento. delivery_draft
contiene destinatario, teléfono, dirección, ciudad, región, país CO y campos
opcionales de complemento/código postal; no acepta JSON arbitrario. No hay CRUD administrativos
de clientes ni catálogo. Durante DRAFT se permite guardar cantidad, comprador y
destino; producto distinto implica otra compra. Dos ediciones DRAFT usan última
escritura válida: no se promete edición colaborativa ni detección de cada cambio
entre pestañas. PATCH y creación de intento se serializan bloqueando checkout;
una vez PAYMENT_PENDING ninguna edición puede modificar el intento.

### `transactions` / Checkout: un intento de pago

| Grupo        | Campos                                                                                                                                                                                                                               | Integridad                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Identidad    | checkout_id FK, attempt_number integer, reference varchar(64)                                                                                                                                                                        | UNIQUE(checkout_id, attempt_number), UNIQUE reference                                   |
| Idempotencia | idempotency_key uuid, create_request_hash char(64), pay_request_hash char(64) ?                                                                                                                                                      | UNIQUE(checkout_id, idempotency_key); hashes de entrada normalizada, sin guardar tokens |
| Resultado    | status varchar(32), dispatch_status varchar(32), last_error_code varchar(64) ?                                                                                                                                                       | Estados y combinaciones del flujo; errores seguros propios                              |
| Proveedor    | provider_transaction_id varchar(128) ?, provider_environment varchar(16)                                                                                                                                                             | UNIQUE(provider_environment, provider_transaction_id); UAT_SANDBOX                      |
| Histórico    | product_id FK, product_name varchar(120), product_description text, quantity smallint, unit_price_cents integer, base_fee_cents integer, delivery_fee_cents integer, currency char(3), buyer_snapshot jsonb, delivery_snapshot jsonb | Información congelada al crear el intento; solo datos necesarios de comprador/destino   |
| Aceptaciones | acceptance_evidence jsonb ?                                                                                                                                                                                                          | Tipos/URLs de contratos, digests y fecha de aceptación explícita, sin tokens en claro   |
| Fechas       | submission_started_at timestamptz ?, finalized_at timestamptz ?                                                                                                                                                                      | Inicio antes de HTTP; finalized_at solo terminal                                        |

No duplicar los importes en otro snapshot JSON ni guardar un total independiente:
`total = quantity × unit_price_cents + base_fee_cents + delivery_fee_cents`.
Una función Money compartida lo calcula y valida; SQL usa casts a bigint para
el CHECK del límite. El importe del proveedor debe coincidir con ese total.
Copiar nombre/descripción y comprador/destino sí es necesario: no deben cambiar
con futuras ediciones del catálogo o borrador.

Índices únicos parciales por checkout: uno WHERE status='PENDING' y otro WHERE
status='APPROVED'. Índice `(checkout_id, created_at)` para el historial. Los
repositorios solo exponen operaciones que cambian estado/identificador del
proveedor, nunca actualizan campos históricos. Tests de integración comprueban
esa inmutabilidad por la aplicación. Se eliminan triggers: cambios directos por
un rol SQL privilegiado no quedan protegidos por esta garantía; no se ofrecen
rutas administrativas de edición y la aplicación no tendrá permisos DDL.

### Reservas y entregas

| Tabla / propietario                | Campos relevantes                                                                               | Integridad                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `inventory_reservations` / Catalog | transaction_id FK, product_id FK, quantity smallint, status varchar(16), expires_at timestamptz | UNIQUE transaction_id; HELD/CONFIRMED/RELEASED; índice `(product_id, status)`                                          |
| `deliveries` / Fulfillment         | checkout_id FK, transaction_id FK, status varchar(16)                                           | UNIQUE checkout_id y transaction_id; estado READY; FK compuesto (transaction_id, checkout_id) al intento de esa compra |

Cada intento y su reserva se crean en el mismo commit. Entrega solo existe con
aprobación, en el mismo commit que confirma inventario. Su producto/destino
histórico se obtiene del intento: no se copia otra vez. READY significa lista
para entregar, no integración con transportista.

`products.stock` son unidades aún no vendidas. Disponible = stock menos la suma
de reservas HELD vigentes. Una HELD con envío NOT_SENT y expires_at vencido deja
de ocupar disponibilidad; si el envío es IN_FLIGHT/SUBMITTED/UNKNOWN, sigue
ocupándola **sin importar esa fecha**. La lectura usa la misma regla que la
escritura. Al aprobar se decrementa stock y se marca CONFIRMED; al rechazar se
marca RELEASED. No hay contador reserved duplicado ni tabla inventory separada.

La creación de reserva y el inicio/finalización bloquean la fila products antes
de evaluar capacidad. Todos los escritores siguen checkout -> intento propio
(si existe) -> product -> reserva propia. Así dos compradores no reservan la
última unidad; no se bloquean compras ajenas para limpiar reservas vencidas.

## Migraciones y seed (pendientes)

1. DataSource CLI con la configuración existente; conservar synchronize=false y
   migrationsRun=false. Migraciones explícitas: catálogo/sesión/compra, después
   intentos/reservas/entregas con CHECKs, FKs e índices.
2. Seed con SKUs e IDs fijos: INSERT ON CONFLICT DO NOTHING, producto y stock
   inicial juntos. Ejecutarlo dos veces no duplica filas ni restablece stock vendido.
3. Probar migraciones desde una base vacía aislada, seed repetido y restricciones.
   No borrar ni recrear la base local para los tests. Los comandos de migración,
   seed e integración todavía no existen; se añadirán con su implementación.

Solo datos ficticios en sandbox. No se incluye un sistema de retención o
anonimización en este assessment; antes de usar datos reales se requiere definir
retención, acceso, copias de seguridad y borrado. No se presenta esa necesidad
como resuelta por omitirla del alcance.
