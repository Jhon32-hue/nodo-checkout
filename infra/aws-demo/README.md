# Demo AWS de Nodo

Guía de la demo publicada en `us-east-2`, sin dominio propio. El recorrido y las
pruebas del proyecto están en el [README raíz](../../README.md).

- [Aplicación](https://hq1tzuevc3.execute-api.us-east-2.amazonaws.com).
- [Swagger](https://hq1tzuevc3.execute-api.us-east-2.amazonaws.com/docs).
- [OpenAPI público](https://hq1tzuevc3.execute-api.us-east-2.amazonaws.com/docs-json)
  y [versionado](../../docs/openapi.json).

## Arquitectura desplegada

```text
Navegador --HTTPS--> HTTP API (*.execute-api.us-east-2.amazonaws.com)
                     |-- GET /, /index.html, /assets/*, /images/*, /fonts/*
                     |     --> Lambda Node.js 24 --> S3 privado
                     `-- $default: /api/*, /docs, /docs-json y otros
                           --> VPC Link --> ALB interno (HTTP privado)
                               --> ECS Fargate:3000 --> RDS PostgreSQL (TLS)
                                     `-- HTTPS --> proveedor Sandbox / AWS
```

La SPA usa `/api/v1` del mismo origen. HTTP API conserva cookies y las cabeceras
`Origin`, `X-CSRF-Token` e `Idempotency-Key`; las respuestas privadas no se cachean. Swagger se
sirve desde NestJS. No se utiliza CloudFront ni un dominio personalizado.

La tarea Fargate tiene IP pública para salir sin NAT Gateway, pero el puerto 3000
solo admite tráfico del ALB. El ALB acepta tráfico del VPC Link y RDS solo de las
tareas. RDS es privada, cifrada, PostgreSQL 17, Single-AZ, `db.t4g.micro`, con
20 GiB gp3. Fargate usa Linux x86, 0.25 vCPU y 0.5 GiB; la demo permite como máximo
una tarea del servicio.

Lambda solo lee `index.html`, `assets/*`, `images/*` y `fonts/*` del bucket privado;
no accede a secretos ni a RDS. Valida rutas, devuelve MIME y binarios base64 y
limita cada objeto a 4 MiB. HTML usa `no-store`, los assets compilados caché
inmutable y fotos/fuentes cinco minutos. La navegación de la SPA usa hash.

## Configuración y secretos

El despliegue publicado utiliza `image_tag=5cf248042d50` y `desired_count=1`.
Antes de actualizar se contrastan con ECS y ECR. Los valores por defecto de
Terraform son `initial` y cero tareas: **no representan el servicio publicado**.
`project` y la región deben mantenerse estables.

- Terraform configura conexión PostgreSQL, `PGSSLMODE=verify-full` y
  `FRONTEND_ORIGINS`; el origen es la URL HTTPS de HTTP API.
- El secreto de aplicación contiene `CSRF_SECRET` estable, de al menos 32
  caracteres, y las credenciales de pagos con los nombres exactos de
  [.env.example](../../.env.example) y [compute.tf](compute.tf).
- Los valores se cargan directamente en Secrets Manager fuera de Terraform.
  Terraform administra metadatos y ARN, sin leer versiones ni valores secretos.
- RDS administra su contraseña en otro secreto. ECS obtiene los secretos al
  iniciar cada tarea; una rotación requiere renovar las tareas de forma controlada.

TLS permanece validado para AWS, proveedor y PostgreSQL. Los secretos no se
imprimen ni se incluyen en comandos, imágenes, planes o logs. `synchronize` y
`migrationsRun` permanecen en `false`.

El estado Terraform es **local**, sin backend remoto. Se conserva con acceso
restringido y respaldo privado; un entorno existente no se administra con un
estado vacío. Estado, planes, `.terraform/`, `.local/` y `.tfvars` están ignorados.
El archivo `.terraform.lock.hcl` sí se versiona.

## Verificar salud y logs

Los ejemplos usan PowerShell, AWS CLI v2 autenticada y Terraform sobre el mismo
directorio y estado local. Desde `infra/aws-demo`:

```powershell
$url = terraform output -raw application_url
foreach ($path in @('/', '/api/v1/products', '/docs', '/docs-json')) {
  $response = Invoke-WebRequest "$url$path" -UseBasicParsing
  "$path -> $($response.StatusCode)"
}
$cluster = terraform output -raw cluster_name
$service = terraform output -raw service_name
aws ecs describe-services --region us-east-2 --cluster $cluster --services $service --query 'services[].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount}'
$targetGroup = aws elbv2 describe-target-groups --region us-east-2 --names $service --query 'TargetGroups[0].TargetGroupArn' --output text
aws elbv2 describe-target-health --region us-east-2 --target-group-arn $targetGroup --query 'TargetHealthDescriptions[].TargetHealth.State'
aws logs tail "/nodo/$cluster/api" --region us-east-2 --since 10m --follow
```

Se esperan HTTP `200`, una tarea en ejecución y el target del ALB `healthy`.
El health check del contenedor y del ALB consulta `/` de NestJS; no demuestra por
sí solo la disponibilidad del proveedor. El OpenAPI público debe coincidir
semánticamente con el versionado. Para comprobar sesión y configuración sin
cobrar se sigue la guía del README raíz en Swagger del mismo navegador.

CloudWatch conserva logs siete días: `/nodo/<cluster>/api`,
`/nodo/<cluster>/gateway` y `/aws/lambda/<cluster>-spa`. Los eventos financieros
son metadatos sanitizados, sin tarjeta, tokens, cookies ni datos de entrega.
API Gateway registra ruta, estado y latencia. Estas consultas no crean pagos
ni ejecutan sync.

## Reproducir o actualizar con seguridad

Requisitos: AWS CLI v2, Terraform `>=1.10, <2.0`, Docker y Node.js 24. El runner
validado para Terraform es Linux, conservando el mismo estado local. Las
credenciales pertenecen al entorno del proceso, con TLS validado y sin `TF_LOG`.
La identidad se comprueba con `aws sts get-caller-identity --region us-east-2`.

### Actualizar la demo existente

Cada plan declara **ambos** parámetros; `apply` recibe el archivo guardado que ya
los contiene. `fmt`, `init`, `validate`, `show` y `output` no aplican cambios ni
necesitan esos parámetros. No se reutilizan planes antiguos.

1. Desde la raíz, construir y subir una imagen con tag inmutable. Docker debe
   estar autenticado en ECR mediante configuración temporal fuera del repositorio,
   sin imprimir credenciales ni alterar su configuración global:

   ```powershell
   $repository = terraform -chdir=infra/aws-demo output -raw image_repository
   $tag = git rev-parse --short=12 HEAD
   docker build --platform linux/amd64 -t "${repository}:$tag" backend
   docker push "${repository}:$tag"
   ```

   El tag no puede existir con otra imagen; ECR es inmutable. No se usa `latest`
   ni se copia `.env`. Una actualización solo de SPA no requiere nueva imagen API.

2. Desde `infra/aws-demo`, validar y planificar. `$tag` debe estar confirmado en
   ECR; para conservar la API se usa su tag desplegado, no el HEAD automáticamente:

   ```powershell
   if ([string]::IsNullOrWhiteSpace($tag)) { throw 'Falta seleccionar el tag confirmado en ECR.' }
   $desiredCount = 1
   terraform fmt -check
   terraform init -backend=false
   terraform validate
   node --test test/static-handler.test.mjs
   New-Item -ItemType Directory -Force .local | Out-Null
   terraform plan -var="image_tag=$tag" -var="desired_count=$desiredCount" -out=.local/update.tfplan
   terraform show .local/update.tfplan
   ```

   Se revisan identidad, región, imagen, tareas y recursos afectados. RDS debe
   quedar sin cambios en una actualización de imagen. Una sustitución o eliminación
   inesperada detiene el procedimiento; no se usa `-target` ni se desactiva refresh.
   Después de aprobar el plan, se aplica únicamente ese archivo:

   ```powershell
   terraform apply .local/update.tfplan
   ```

   El servicio de una tarea puede interrumpirse durante el reemplazo. No ejecuta
   migraciones ni seed automáticamente. Si hacen falta cambios SQL, se preparan
   respaldo y ventana de mantenimiento, se instala la revisión con cero tareas
   mediante un plan explícito y se utilizan las tareas puntuales indicadas abajo.

3. Para actualizar la SPA, desde la raíz se compila y sube solo el `dist` recién
   generado. El HTML se publica al final y se conservan los assets anteriores:

   ```powershell
   npm --prefix frontend ci
   npm --prefix frontend run build
   $bucket = terraform -chdir=infra/aws-demo output -raw spa_bucket
   aws s3 sync frontend/dist "s3://$bucket/" --exclude index.html --region us-east-2
   aws s3 cp frontend/dist/index.html "s3://$bucket/index.html" --cache-control no-cache --region us-east-2
   ```

   Finalmente se verifican salud, catálogo, Swagger, OpenAPI y sesión, sin
   necesidad de iniciar pagos.

### Primera instalación o mantenimiento SQL

Una instalación nueva utiliza su propio estado y prefijo `project`; no reutiliza
el de la demo. El primer plan declara `image_tag=initial` y `desired_count=0`.
El prefijo elegido se pasa también a todos los planes de ese entorno.
Tras crear ECR, RDS y el secreto vacío, se sube la imagen y se cargan los secretos
fuera de Terraform. Luego se instala el tag real, todavía con cero tareas.
Para el entorno elegido, desde `infra/aws-demo`:

```powershell
terraform plan -var="image_tag=$tag" -var="desired_count=0" -out=.local/maintenance.tfplan
terraform show .local/maintenance.tfplan
# Solo después de revisar el plan:
terraform apply .local/maintenance.tfplan
./run-maintenance.ps1 migrate
# Solo para inicializar productos en una instalación nueva:
./run-maintenance.ps1 seed
```

Cada script inicia una tarea separada con la imagen y secretos configurados y
exige salida `0`. Un fallo detiene la secuencia. El seed no se repite como parte
rutinaria de las actualizaciones. Tras cargar la SPA, se genera y revisa otro plan
con el mismo tag y `desired_count=1`, como en la actualización. La API no migra
al arrancar.

## Costos y límites

La estimación de planificación es **USD 45–55/mes** para 730 horas y tráfico bajo,
sin impuestos ni créditos; no es una cotización actual ni un límite de gasto.
ALB, RDS y almacenamiento siguen consumiendo aunque ECS esté en cero. El costo
depende de horas, LCU, IPv4 pública, solicitudes HTTP API/Lambda, almacenamiento
S3/ECR, logs, transferencia, backups y posibles créditos CPU de RDS.

Las tarifas y el consumo real se revisan en Billing y en las páginas de
[Fargate](https://aws.amazon.com/fargate/pricing/),
[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/),
[RDS](https://aws.amazon.com/rds/postgresql/pricing/),
[API Gateway](https://aws.amazon.com/api-gateway/pricing/),
[Lambda](https://aws.amazon.com/lambda/pricing/) e
[IPv4/transferencia](https://aws.amazon.com/vpc/pricing/).
No se presenta un saldo de créditos como vigente. El plan previsto para mantener
la demo es FREE; su estado y vencimiento se consultan antes de operar con
`aws freetier get-account-plan-state --region us-east-2`. Según las
[condiciones del plan](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html),
su duración depende del plazo y los créditos disponibles. No se cambia a PAID.
El límite personal de USD 10 fuera de créditos no está implementado como hard cap.

Una tarea, RDS Single-AZ y el usuario maestro administrado son decisiones de esta
demo, no alta disponibilidad de producción ni roles SQL separados. HTTP API
limita a 10 solicitudes/s con ráfaga de 20; Lambda admite objetos de hasta 4 MiB.
No hay NAT Gateway, CDN ni dominio propio.

## Retirar la demo al terminar la evaluación

Mantendré la demo disponible durante la evaluación. Antes de retirarla revisaré
qué datos conservar y los exportaré. Conservaré el estado local y comprobaré que
no queden tareas de mantenimiento. Reduciré el servicio a cero mediante un plan
revisado que incluya el tag desplegado y `desired_count=0`.

Vaciaré el bucket de la SPA y el repositorio ECR exactos obtenidos de los outputs;
su contenido bloquea la eliminación. Revisaré el plan de retirada con ambos
parámetros explícitos y aplicaré solo el archivo aprobado:

```powershell
# $tag conserva el tag de la imagen desplegada.
terraform plan -destroy -var="image_tag=$tag" -var="desired_count=0" -out=.local/teardown.tfplan
terraform show .local/teardown.tfplan
# Solo cuando termine la evaluación y los datos estén preservados:
terraform apply .local/teardown.tfplan
```

RDS está configurado **sin snapshot final automático**: destruirla elimina sus
datos. El secreto de aplicación tiene siete días de recuperación y RDS elimina
su secreto administrado. Después comprobaré recursos y cargos residuales,
incluidos snapshots manuales, tareas, interfaces y almacenamiento restante.
