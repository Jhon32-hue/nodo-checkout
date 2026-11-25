# Payment Checkout

Base técnica de un checkout: NestJS 11, TypeScript, TypeORM 1.1.3 y PostgreSQL 17.
Por ahora `GET /` devuelve `Hello World!`. No hay tablas de negocio, migraciones,
frontend ni integración de pagos.

## Requisitos

- Node.js 24 y npm (verificados con Node.js 24.11.1 y npm 11.6.2).
- Docker Desktop en ejecución con contenedores Linux y Docker Compose.
- Git. En Windows, ejecutar desde PowerShell.

## Instalación local

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
docker compose up -d db
docker compose ps
Set-Location backend
npm ci
npm run start:dev
```

Copiar `.env.example` solamente la primera vez; conservar la configuración local
si `.env` ya existe. Esperar a que `db` aparezca como `healthy`.

La API queda en <http://localhost:3000>, Swagger en
<http://localhost:3000/docs> y OpenAPI en <http://localhost:3000/docs-json>.
Si se cambia `PORT`, ajustar esas direcciones. Detener NestJS con Ctrl+C.
En Linux, usar `cp .env.example .env` y `cd backend` para los pasos equivalentes.

## Configuración

Todas estas variables son obligatorias:

| Variable      | Regla               | Ejemplo local      |
| ------------- | ------------------- | ------------------ |
| `DB_HOST`     | Texto no vacío      | `127.0.0.1`        |
| `DB_PORT`     | Entero de 1 a 65535 | `5433`             |
| `DB_NAME`     | Texto no vacío      | `payment_checkout` |
| `DB_USER`     | Texto no vacío      | `checkout`         |
| `DB_PASSWORD` | Texto no vacío      | Definir en `.env`  |
| `PORT`        | Entero de 1 a 65535 | `3000`             |

Los puertos se validan y convierten a números al iniciar. Una configuración
inválida impide arrancar y reporta los nombres de las variables, sin sus valores.
La contraseña se conserva exactamente, sin recortar espacios.

NestJS busca `.env` en el directorio de ejecución y después en su padre; el
primero tiene prioridad. Las variables del proceso tienen prioridad sobre esos
archivos. Docker Compose lee el `.env` de la raíz.

En AWS se deben inyectar los mismos nombres mediante la configuración del
servicio y su gestor de secretos; no se necesita distribuir un archivo `.env`.
`DB_HOST` y `DB_PORT` deben apuntar a la base accesible desde el servicio, y `PORT`
debe coincidir con el puerto configurado para el backend. No registrar ni
versionar credenciales. El ejemplo de contraseña es exclusivo del entorno local.
El despliegue AWS y la configuración TLS de PostgreSQL quedan pendientes.

## Base de datos local

PostgreSQL escucha en `127.0.0.1:5433` desde Windows y en `5432` dentro del
contenedor. El volumen `postgres_data` conserva los datos. Las variables de
inicialización de PostgreSQL solo se aplican al crear un volumen vacío; cambiar
`.env` no cambia automáticamente usuarios ni contraseñas existentes.

Desde la raíz:

```powershell
docker compose ps
docker compose logs --tail 50 db
docker compose stop db
docker compose up -d db
```

TypeORM mantiene `synchronize: false` y `migrationsRun: false`. Todavía no hay
comandos de migración ni seed; se agregarán en la siguiente tarea.

## Verificación

Con PostgreSQL saludable, desde `backend`:

```powershell
npm run format:check
npm run lint:check
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Las pruebas unitarias cubren configuración ausente, vacía, puertos inválidos y
límites válidos. Las e2e usan la base real configurada: verifican una consulta
SQL, la ruta inicial, Helmet, Swagger y el ValidationPipe global. No crean tablas
ni escriben datos. Los endpoints de prueba solo existen en el módulo de tests.

Para generar cobertura: `npm run test:cov -- --runInBand`. El objetivo de cobertura
del producto completo se verificará al implementar el negocio.

Para probar la ejecución compilada:

```powershell
npm run build
npm run start:prod
```

## Formato y seguridad

Git (`.gitattributes`), el editor (`.editorconfig`) y Prettier utilizan LF para
mantener el mismo formato en Windows y Linux. Se conservan comillas simples y
comas finales. `npm run format` corrige TypeScript; `npm run lint` conserva el
comando existente con autocorrección. Los comandos `*:check` solo verifican.

Helmet configura cabeceras HTTP. El ValidationPipe global transforma DTOs y
rechaza propiedades adicionales con `whitelist` y `forbidNonWhitelisted`.
Las futuras solicitudes de negocio deberán declarar DTOs con validaciones.
Swagger documenta la base actual y no incluye credenciales.

`.env`, `node_modules`, `dist`, cobertura y logs están excluidos de Git.
No hay despliegue, contenedor del backend ni configuración de producción todavía.
