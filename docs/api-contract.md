# API: catálogo y compra recuperable

**Implementados:** catálogo GET /products y /products/:id; POST /checkout-sessions,
POST /checkouts, GET/PATCH /checkouts/:id y GET /checkouts/:id/summary, bajo /api/v1.
También POST /transactions y GET /transactions/:id están implementados.
GET /payments/config, POST /transactions/:id/pay y /:id/sync también están implementados.
GET /, /docs y /docs-json se conservan. Webhook sigue **propuesto**. Ver [modelo](data-model.md) y [flujo](checkout-flow.md).

## Reglas comunes

JSON camelCase, IDs UUID, fechas UTC e importes enteros en centavos COP.
Rechazar campos desconocidos y tipos inválidos. No aceptar precios del cliente
como autoridad, IDs remotos arbitrarios ni estados aprobados enviados por UI.

- **S:** cookie guest vigente; comprobar propiedad de checkout/transacción.
  Sin sesión: 401. Recurso ajeno/inexistente: mismo 404 sin PII.
- **W:** S + Origin permitido y X-CSRF-Token. Cookie HttpOnly, SameSite=Lax,
  Secure en HTTPS; token aleatorio con digest en DB, 24 horas. Origin obligatorio
  al emitir sesión; CSRF se deriva de la sesión con secreto backend.
- Content-Type application/json en requests con cuerpo; respuestas privadas
  Cache-Control: no-store. No ETag, If-Match, cursor, versión ni TTL de resumen.
- Formato de éxito `{ "data": ... }`; error `{ "error": { "code": "...",
"message": "..." } }`. requestId/correlación permanece propuesto; no se implementó
  middleware adicional en este bloque. Nunca registrar cuerpos de tarjeta, tokens,
  cookies, datos de comprador o direcciones.

## Catálogo disponible

El catálogo tiene diez productos tecnológicos. category es audio, computacion,
accesorios, almacenamiento u hogar-inteligente; admite null solo para registros
ajenos preexistentes sin clasificar. No hay filtros ni CRUD de categorías.

Ambas consultas son públicas y devuelven Cache-Control: no-store. Listado:
`{ "data": { "items": [...] } }`, orden por ID; detalle real de los auriculares:

```json
{
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "sku": "AUD-001",
    "category": "audio",
    "name": "Auriculares inalámbricos Nova",
    "description": "Auriculares Bluetooth con micrófono integrado, controles táctiles y estuche de carga USB-C. Diseño compacto para llamadas, música y uso diario. Incluyen cable de carga y almohadillas.",
    "imageUrl": "https://placehold.co/800x600/png?text=Auriculares",
    "unitPriceCents": 12990000,
    "currency": "COP",
    "available": 10
  }
}
```

El parlante conserva ID `22222222-2222-4222-8222-222222222222`, precio 17990000
centavos COP y disponibilidad local 5 al verificar. Valores reales cambian si
se consume stock; el seed no los repone. Productos inactivos se ocultan; los
agotados siguen devolviendo 200 con available=0. Orden por UUID ascendente, sin paginación ni duplicados.
Cualquier query, incluido limit/cursor, devuelve 400 INVALID_QUERY_PARAMS.
[OpenAPI exportado desde /docs-json](openapi.json). Las imageUrl son placeholders
PNG de texto verificados por HTTP, no imágenes físicas del producto.

Detalle: 400 INVALID_PRODUCT_ID para formato distinto de UUID v4; 404
PRODUCT_NOT_FOUND para inexistente/inactivo. Ambas rutas pueden devolver 503
CATALOG_UNAVAILABLE, sin mensajes internos de PostgreSQL. Los códigos de error
se envuelven en error.code/error.message. Swagger describe parámetros y respuestas.

## Endpoints

GET y POST checkout-sessions no admiten body; POST sync tampoco lo necesita; los campos de entrada de las demás rutas se
indican abajo. Los códigos de forma/autorización/infraestructura son comunes.

| Método y ruta bajo /api/v1  | Caso de uso / acceso                            | Entrada                                                  | Éxito y efecto                                                                                          | Errores clave                                                                               |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| POST /checkout-sessions     | EnsureCheckoutSession / Origin; cookie opcional | Sin cuerpo                                               | 201 nueva con Set-Cookie o 200 existente sin renovarla; data.csrfToken y data.expiresAt                 | 403 Origin, 503                                                                             |
| GET /products               | ListProducts / público                          | Sin query ni cuerpo                                      | 200 lista completa del seed y disponibilidad; sin reservar                                              | 400 query no admitida, 503                                                                  |
| GET /products/:id           | GetProduct / público                            | UUID                                                     | 200 detalle/precio/stock; sin efectos                                                                   | 404 producto inactivo/inexistente                                                           |
| POST /checkouts             | CreateCheckout / W                              | productId, quantity                                      | 201 DRAFT; sin reserva                                                                                  | 400 cantidad, 404 producto                                                                  |
| GET /checkouts/:id          | GetCheckout / S                                 | UUID                                                     | 200 comprador/destino propios, status, activeTransactionId y latestTransactionId; restaura formulario   | 404                                                                                         |
| PATCH /checkouts/:id        | UpdateCheckout / W                              | quantity y/o buyer y/o delivery                          | 200 borrador actualizado; objetos buyer/delivery completos si presentes, solo DRAFT                     | 409 CHECKOUT_LOCKED, 422 datos inválidos                                                    |
| GET /checkouts/:id/summary  | GetSummary / S                                  | UUID                                                     | 200 resumen calculado, o congelado si existe intento activo/pagado; sin escrituras                      | 422 INCOMPLETE_CHECKOUT                                                                     |
| GET /payments/config        | GetPaymentConfig / S                            | Sin cuerpo                                               | 200 llave pública, ambiente, tokens y links reales de los dos contratos                                 | 503 GATEWAY_UNAVAILABLE                                                                     |
| POST /transactions          | CreateTransaction / W                           | checkoutId, acceptedSummary; header Idempotency-Key UUID | 201 ID interno PENDING, reserva y snapshot en un commit; replay devuelve mismo intento                  | 409 SUMMARY_CHANGED/INSUFFICIENT_STOCK/CHECKOUT_LOCKED/IDEMPOTENCY_CONFLICT, 422 incompleto |
| POST /transactions/:id/pay  | StartPayment / W                                | cardToken, installments=1, acceptance                    | 202 pendiente o 200 final; claim durable antes de HTTP; idempotente por ID+hash                         | 409 PAYLOAD_CONFLICT/RESERVATION_EXPIRED, 422 aceptación/cuota                              |
| GET /transactions/:id       | GetTransaction / S                              | UUID                                                     | 200 estado local y summary histórico; nunca consulta/cobra al proveedor                                 | 404                                                                                         |
| POST /transactions/:id/sync | SyncPayment / W                                 | UUID, sin cuerpo                                         | 200 final/no enviado, 202 pendiente/incierto; consulta proveedor y finalización compartida, nunca cobro | 409 OBSERVATION_CONFLICT, 503 proveedor                                                     |
| POST /webhooks/payments     | ReceivePaymentEvent / firma de proveedor        | Evento transaction.updated                               | 200 tras procesamiento durable, duplicado o ajeno ignorado; misma finalización                          | 400 esquema, 403 firma, 503 persistencia                                                    |

Validaciones mínimas: quantity 1..99; buyer.fullName y recipientName 2..120,
email válido <=254, teléfonos E.164 <=16; addressLine1 3..200, city/region 2..100,
country CO; addressLine2 y postalCode opcionales con máximo 200/12. Token de
tarjeta y aceptaciones no vacíos, opacos y con límites de tamaño de DTO; ambas
aceptaciones explícitas true. Implementar límites de cuerpo y frecuencia al
exponer API; no son middleware existente. Clientes y entregas se gestionan por
la compra: sin listados públicos ni CRUD extra.

POST checkouts no exige clave: doble clic puede crear dos borradores sin reserva
ni cobro; la UI deshabilita el botón. La garantía financiera empieza en el intento.
CreateTransaction guarda clave/hash; cambiar entrada con la misma clave es 409.
Pay compara hash antes de revalidar el estado temporal: replay recupera el estado,
no reenvía. Con respuesta perdida, GET/sync. GET siempre es lectura local.

PATCH vacío, propiedades desconocidas (también anidadas) y null en campos
obligatorios devuelven 400 INVALID_REQUEST; se normalizan espacios exteriores.
La aplicación vuelve a comprobar reglas de negocio y devuelve 422 INVALID_BUYER,
INVALID_DELIVERY, INVALID_QUANTITY o INVALID_AMOUNT. Error SQL: 503
PERSISTENCE_UNAVAILABLE sanitizado. PATCH comprueba propiedad/estado bajo lock y
guarda cliente específico de la compra y delivery_draft en el mismo commit.
No hay filas deliveries hasta implementar aprobación; no modifica inventario.
El resumen de producto inactivo o compra bloqueada sin histórico devuelve 409
CHECKOUT_LOCKED. Las operaciones privadas usan Cache-Control: no-store.

Vista de compra: data contiene id, productId, quantity, status, buyer y delivery
(objetos o null), activeTransactionId, latestTransactionId y deliveryId (IDs o null).
[Recorrido PowerShell con cookies/Origin/CSRF](../README.md#probar-compra-recuperable-powershell).

Resumen DRAFT se recalcula con el catálogo/tarifas actuales, sin guardarse.
CreateTransaction compara **todos** los campos de acceptedSummary con el cálculo
servidor bajo lock: 409 si cambió, UI vuelve a mostrar resumen. En intento
activo o compra pagada, GetSummary devuelve el histórico, sin proponer otro cobro.
Disponibilidad mostrada es informativa; reservar exige comprobación SQL atómica.

## Ejemplos breves

Datos ficticios; los IDs representan recursos distintos. No son fixtures UAT.

Crear compra (POST checkouts):

```json
{ "productId": "11111111-1111-4111-8111-111111111111", "quantity": 2 }
```

Guardar comprador/destino (PATCH checkout; misma forma en GET para restaurarlos):

```json
{
  "buyer": {
    "fullName": "Cliente Ejemplo",
    "email": "cliente@example.test",
    "phone": "+573000000000"
  },
  "delivery": {
    "recipientName": "Cliente Ejemplo",
    "phone": "+573000000000",
    "addressLine1": "Calle de ejemplo 1",
    "city": "Bogotá",
    "region": "Bogotá D.C.",
    "country": "CO"
  }
}
```

Respuesta GET summary; total no se guarda otra vez en la base:

```json
{
  "data": {
    "quantity": 2,
    "unitPriceCents": 12990000,
    "subtotalCents": 25980000,
    "baseFeeCents": 50000,
    "deliveryFeeCents": 100000,
    "totalCents": 26130000,
    "currency": "COP"
  }
}
```

Crear intento, Idempotency-Key `55555555-5555-4555-8555-555555555555`:

```json
{
  "checkoutId": "22222222-2222-4222-8222-222222222222",
  "acceptedSummary": {
    "quantity": 2,
    "unitPriceCents": 12990000,
    "baseFeeCents": 50000,
    "deliveryFeeCents": 100000,
    "currency": "COP"
  }
}
```

Respuesta de intento (POST transactions / GET transaction / pay comparten estos
campos; GET añade summary histórico, reference, createdAt y finalizedAt nullable):

```json
{
  "data": {
    "id": "33333333-3333-4333-8333-333333333333",
    "checkoutId": "22222222-2222-4222-8222-222222222222",
    "status": "PENDING",
    "dispatchStatus": "NOT_SENT",
    "reservationExpiresAt": "2026-11-25T15:10:00.000Z",
    "deliveryId": null
  }
}
```

Iniciar cobro (tokens son placeholders, no sirven para pagar):

```json
{
  "cardToken": "card-token-placeholder",
  "installments": 1,
  "acceptance": {
    "acceptanceToken": "policy-placeholder",
    "personalAuthToken": "privacy-placeholder",
    "policyAccepted": true,
    "personalDataAccepted": true
  }
}
```

Ante timeout: 202, status PENDING, dispatchStatus UNKNOWN y Retry-After 5. Ante
aprobación: 200, APPROVED/SUBMITTED y deliveryId. Rechazo: 200 DECLINED/SUBMITTED,
sin entrega; no es un error HTTP. GET informa además reservationExpired para
NOT_SENT vencido (incluye históricos EXPIRED), sin mutar filas; pay marca EXPIRED/RELEASED y devuelve 409.

## Errores y recuperación

400 estructura; 401 sesión; 403 CSRF/firma/Origin; 404 recurso ajeno/inexistente;
409 conflicto de estado, resumen, clave/payload o stock; 422 validación de
negocio; 429 con Retry-After para frecuencia; 503 infraestructura no disponible.
Diagnóstico interno del adaptador: operación configuration/creation/query, motivo
transport/http/json/schema (o configuración local inválida) y HTTP externo cuando
existe. Logs con lista permitida: ID local, referencia, etapa, código sanitizado,
HTTP e ID remoto validado; sin cuerpos, tokens ni datos del comprador. La respuesta
pública conserva su formato y no expone estos detalles internos.

No filtrar errores/cuerpos externos. UNKNOWN mantiene reserva y bloquea nuevo
intento. Un 503 después de posible envío tampoco autoriza otro cobro: consultar.
Un nuevo intento solo tras resultado negativo definitivo o EXPIRED sin envío;
se utiliza otra clave y otra referencia, conservando el historial.

## Intentos y reservas implementados

Crear intento usa Idempotency-Key UUID v4. Hash determinista del checkoutId
normalizado y los cinco campos aceptados; el orden JSON no cambia su significado.
Misma clave/entrada devuelve 201 con el intento existente, incluso si su estado
cambió. Otra entrada: 409 IDEMPOTENCY_CONFLICT. Otra clave con intento activo o
compra PAID: 409 CHECKOUT_LOCKED. No se acepta tarjeta/PII/estado en este POST.

Bajo locks checkout -> intento propio -> producto -> reserva propia, recalcula
resumen/disponibilidad, congela snapshots, crea PENDING/NOT_SENT y HELD (10 min),
y cambia la compra a PAYMENT_PENDING en un commit. Stock físico y entregas intactos.
Resumen distinto o stock insuficiente: 409 SUMMARY_CHANGED/INSUFFICIENT_STOCK;
producto inactivo: 404 PRODUCT_NOT_FOUND; compra incompleta: 422.
Un error SQL devuelve 503 sanitizado y revierte las escrituras parciales.

Una reserva NOT_SENT vencida propia puede pasar a EXPIRED/RELEASED; esa transición
se confirma incluso si la evaluación posterior devuelve un error de negocio.
IN_FLIGHT/SUBMITTED/UNKNOWN no se liberan por tiempo. No se bloquean compras ajenas.
GET solo lee datos históricos; añade reservationStatus y reservationExpired,
reference, createdAt/finalizedAt y summary. No publica snapshots personales ni
hashes. Recursos ajenos/inexistentes: mismo 404; resultado negativo definitivo: 200.
[Pasos PowerShell](../README.md#crear-intento-y-reservar-powershell).

## Adaptador Wompi y verificaciones pendientes

| Llamada externa               | Responsable                        | Propósito                                                                   |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| GET /merchants/info           | Backend                            | Obtener contratos/tokens; GET y header público verificados en UAT           |
| POST /tokens/cards            | Frontend directo con llave pública | Tokenizar tarjeta; no pasa por nuestro backend                              |
| POST /transactions            | Backend                            | CARD, referencia única, monto histórico, firma de integridad y aceptaciones |
| GET /transactions/:providerId | Backend                            | Confirmar resultado autenticado y comparar referencia/monto/moneda/ambiente |

UAT observado: ambos GET públicos respondieron 200. La clave de cifrado llega como
PEM en una línea; su DER/SPKI RSA 2048 es válido. La verificación cifrada normalizó
solo la representación PEM, usando jose fuera del backend, sin alterar la clave.
El adaptador de pagos usa fetch con timeout de 8 s, redirect:error, sin retries de
POST y con validación de JSON unknown. Solo acepta el host UAT sandbox configurado.
Ausencia/null/esquema inválido/transporte/HTTP se traducen sin cuerpos externos.
GET transaction del proveedor se autentica con llave privada desde el backend.

GET payments/config devuelve data obligatorio: environment=UAT_SANDBOX, publicKey,
tokenizationUrl, installments=1 y acceptance (acceptanceToken, personalAuthToken,
policyUrl, personalDataUrl). No incluye secretos. Sesión vigente y no-store;
configuración o proveedor no disponible: 503 GATEWAY_UNAVAILABLE.

Pay exige tokens opacos sin alterar contenido: cardToken 1..1024; cada aceptación
1..8192, ambos consentimientos true y cuota 1. Se comparan identidad/hash/enlace del
contrato y expiración si figura en el token con contratos vigentes. Esta comparación
no verifica firmas JWT localmente: Wompi valida sus tokens firmados. Replay por
hash se resuelve antes de esta comprobación temporal. El backend firma referencia

- total histórico + COP + secreto con SHA-256 y mapea acceptance_token y
  accept_personal_auth. No acepta ni persiste PAN/CVC ni tokens en claro.

Claim IN_FLIGHT/hash/hora/evidencia mínima (consentimientos y hashes de tokens),
commit, HTTP, persistencia de ID/SUBMITTED y FinalizePayment. No hay SQL abierto
mientras se espera red. Si falla guardar el ID, no se pierde el bloqueo IN_FLIGHT;
si falla la finalización después, el ID ya guardado permite reconsultar por sync.
Un error de creación ambiguo devuelve 202 UNKNOWN, conserva HELD y no habilita
otro POST; un 4xx no se interpreta por defecto como ausencia de cobro.

FinalizePayment valida ID, referencia, importe, moneda y ambiente. APPROVED
aplica stock/CONFIRMED/READY/PAID en un commit; negativo confirmado libera y vuelve
a DRAFT. Mismo terminal: no-op; terminal contrario: 409 OBSERVATION_CONFLICT.
Sync no admite body y nunca crea cobros: NOT_SENT devuelve 200 local; pendiente
identificado se consulta; final 200, pendiente/incierto 202 y Retry-After:5.
Consulta fallida: 503, sin liberar/cambiar el intento. Sin ID solo mantiene el
bloqueo; IN_FLIGHT antiguo (>30 s) pasa a UNKNOWN al sync. Revisión manual sin
búsqueda por referencia inventada. GET local no llama al proveedor ni escribe.

UAT real: un APPROVED verificado con tokenización cifrada 201 y sync 200, stock
10->9 y una entrega; sync repetido sin nuevos efectos. El escenario de rechazo
terminó PENDING/UNKNOWN/HELD, sin reenvío ni DECLINED confirmado. No se declara
resuelto ni se reproduce como éxito simulado. Un ensayo posterior independiente,
con el cliente corregido, sí confirmó DECLINED: creación remota 201, consulta 200,
RELEASED, stock intacto, ninguna entrega y checkout DRAFT. Se guardó evidencia
antes del teardown; esto no recupera el intento perdido. Ver [evidencia resumida](../README.md#pago-sandbox-y-sincronización).
CORS de navegador, rechazo real, eventos y recuperación sin ID no están verificados.

Llave privada y secretos de integridad/eventos solo backend, inyectados; no copiar
credenciales del PDF ni modificar la cuenta compartida. Quedan por verificar CORS de navegador, límites completos y errores que
garantizan ausencia de cobro; los GET de configuración y un aprobado ya se probaron. Búsqueda por referencia **sin ID**
es una capacidad pendiente, no una ruta asumida; si no existe, revisión manual
sin liberar/reintentar automáticamente.

Webhook verifica checksum según properties + timestamp + secreto de eventos,
con comparación segura y paths válidos. Comprobar ambiente y pertenencia local,
reconsultar al proveedor si la firma no cubre todos los datos antes de finalizar.
Si no puede consultar, 503 para reentrega; el usuario también puede usar sync.
Duplicados y consultas simultáneas se absorben por locks/estado terminal, sin
tabla de observaciones. Un conflicto de monto/referencia no finaliza y se registra
con IDs/código seguro. No guardar payloads con PII; no cambiar estados terminales
contradictorios automáticamente.

Referencias públicas consultadas en el diseño previo:
[transacciones](https://docs.wompi.co/docs/colombia/transacciones/),
[aceptaciones](https://docs.wompi.co/docs/colombia/tokens-de-aceptacion/) y
[eventos](https://docs.wompi.co/docs/colombia/eventos/). Son referencias de contrato; las verificaciones reales y sus límites se distinguen arriba.
