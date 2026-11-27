# Demo AWS de Nodo

Infraestructura preparada, **sin aplicar ni desplegar**. Región obligatoria
`us-east-2`; no requiere dominio propio. El plan inicial mantiene ECS en cero.
El frontend existente usa `/api/v1` del mismo origen, sin cambios de código.

```text
Navegador --HTTPS--> CloudFront (*.cloudfront.net)
                     |-- estáticos --> S3 privado (OAC)
                     `-- /api/*, /docs, /docs/*, /docs-json
                           --HTTPS--> HTTP API (*.execute-api.us-east-2.amazonaws.com)
                               --> VPC Link --> ALB interno (HTTP privado)
                                   --> Fargate:3000 --> RDS PostgreSQL privado (TLS)
                                         `-- HTTPS --> proveedor UAT / servicios AWS
```

## Preflight y límites

Consultas de solo lectura del 27 de noviembre de 2026: plan FREE activo,
USD 100 de créditos; Fargate On-Demand 4 vCPU, ALB 50, RDS 40 instancias
(ninguna utilizada), tres AZ disponibles y PostgreSQL 17 `db.t4g.micro`
ofertado. La simulación IAM con `aws:RequestedRegion=us-east-2` permite
las acciones principales; no demuestra disponibilidad física ni sustituye
las restricciones que AWS evalúa al crear recursos. No se cambió el plan.
Revalidar antes de aplicar con `aws sts get-caller-identity --region us-east-2`
y `aws freetier get-account-plan-state --region us-east-2`.

La tarea tiene IP pública **solo para salida sin NAT Gateway**. Su SG admite
3000 únicamente desde el SG del ALB. ALB acepta 80 solo desde VPC Link;
RDS acepta 5432 solo desde tareas. No hay SSH, bastión ni puertos de API públicos.
CloudFront y API Gateway usan sus certificados HTTPS administrados predeterminados.
El tramo VPC Link/ALB/API usa HTTP dentro de la VPC; PostgreSQL exige TLS validado.

CloudFront no cachea API/Swagger: reenvía cookies, `Origin`, `X-CSRF-Token`,
`Idempotency-Key`, Content-Type, Accept y queries; no reenvía Host del visitante.
No se configura CORS automático ni se transforma un error de API en HTML.
La SPA actual navega por hash. `/docs-json` conserva exactamente su contrato.

## Preparar y revisar

Requisitos: AWS CLI v2 autenticada, Terraform >=1.10, Docker y Node.js 24.
No usar root, no cambiar a PAID ni incluir claves en comandos o archivos Terraform.
En Windows, si el TLS corporativo requiere una CA, configurar `AWS_CA_BUNDLE`
con un PEM de certificados confiables; nunca desactivar la validación TLS.

Desde este directorio:

```powershell
terraform fmt -check
terraform init -backend=false
terraform validate
New-Item -ItemType Directory -Force .local | Out-Null
terraform plan -out=.local/initial.tfplan
```

Si el proveedor nativo falla con un error TLS en el canal local del plugin,
usar Terraform en Linux con la imagen oficial `hashicorp/terraform:1.17.2`.
Así se verificaron `init`, `validate` y `plan` en esta revisión, conservando
TLS. Para ese runner, las credenciales se entregaron en memoria por stdin,
sin archivos ni argumentos con valores. La CA de confianza se montó solo
para lectura. El plan revisable queda en `.local/initial.tfplan`.

Si el proveedor no soporta la sesión de `aws login`, exportar credenciales
**solo al entorno del proceso** con `aws configure export-credentials --format process`
y asignarlas en memoria a `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y
`AWS_SESSION_TOKEN`. No imprimir el resultado, usar `TF_VAR_*`, guardar archivos
ni activar `TF_LOG` durante plan/apply. El backend local queda intacto.

El estado local, planes, `.terraform/`, `.local/` y `.tfvars` están ignorados;
conservar `.terraform.lock.hcl`. Guardar estado con ACL privada y no perderlo.
Este demo usa estado local; no crea backend remoto de estado.

## Secuencia futura de despliegue (requiere autorización)

**No ejecutada en esta entrega.** Revisar el plan y el costo antes de aplicar.
No activar ECS hasta completar todos los pasos siguientes.

1. Aplicar el plan revisado manteniendo `desired_count=0`. Esto ya factura
   ALB y RDS aunque aún no haya API. Esperar RDS, VPC Link y CloudFront.
2. Construir la imagen desde la raíz y subirla con un tag inmutable:

   ```powershell
   $repository = terraform -chdir=infra/aws-demo output -raw image_repository
   $registry = ($repository -split '/')[0]
   $tag = git rev-parse --short HEAD
   docker build --platform linux/amd64 -t "${repository}:$tag" backend
   aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin $registry
   docker push "${repository}:$tag"
   terraform -chdir=infra/aws-demo plan -var="image_tag=$tag" -out=.local/image.tfplan
   ```

   Revisar y aplicar ese segundo plan con cero tareas antes de mantenimiento.
   No usar `latest`, modificar el tag inmutable ni introducir `.env` en la imagen.
   Si se requiere una CA corporativa durante el build, añadir
   `--secret "id=build_ca,src=$env:AWS_CA_BUNDLE"` a `docker build`: el PEM
   público se monta solo durante la compilación y no queda en la imagen.

3. Cargar el secreto de aplicación **fuera de Terraform**, mediante la consola
   de Secrets Manager, como JSON con `CSRF_SECRET` (>=32 caracteres estable),
   `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET` del UAT
   autorizado. No usar ejemplos reales, historial de terminal ni archivos
   versionados. RDS genera y administra su contraseña en otro secreto.
   Terraform solo conoce los ARN; nunca lee/escribe versiones o valores.
4. Desde `infra/aws-demo`, ejecutar explícitamente, uno después de otro:

   ```powershell
   ./run-maintenance.ps1 migrate
   ./run-maintenance.ps1 seed
   ```

   Cada comando inicia una tarea puntual en **esta nueva base AWS**, con la
   misma imagen, configuración y secretos. Exigir salida 0 en ambas tareas.
   No ejecutarlos contra PostgreSQL de desarrollo. La imagen tiene CLI TypeORM
   y seed compilados; no instala ts-node ni migra al iniciar la API.

5. Desde la raíz, compilar/subir únicamente los archivos públicos de la SPA:

   ```powershell
   npm --prefix frontend ci
   npm --prefix frontend run build
   $bucket = terraform -chdir=infra/aws-demo output -raw spa_bucket
   aws s3 sync frontend/dist "s3://$bucket/" --region us-east-2
   aws s3 cp frontend/dist/index.html "s3://$bucket/index.html" --cache-control no-cache --region us-east-2
   ```

6. Planificar `-var="image_tag=$tag" -var="desired_count=1"`, revisar y aplicar
   solo tras imagen, secretos, migración y seed correctos. Confirmar targets sanos.
   Usar los outputs `application_url`, `swagger_url` y `openapi_url`.
   Comprobar catálogo, sesión (Secure/HttpOnly/SameSite), CSRF, resumen y Swagger.
   No declarar pagos UAT comprobados por validar Terraform.

La configuración conserva `synchronize=false` y `migrationsRun=false`.
RDS rota su contraseña administrada; ECS inyecta valores al arrancar cada tarea.
Tras una rotación, reiniciar el servicio de forma controlada para refrescarla.
El usuario maestro administrado se usa en este demo; separar roles SQL de
mantenimiento/aplicación antes de un uso productivo. Una tarea y RDS Single-AZ
priorizan costo; no constituyen alta disponibilidad de producción.

## Inventario y costo orientativo

Tarifas públicas On-Demand de Ohio, 730 h/mes, sin impuestos, descuentos ni créditos.
Supuesto: una tarea 0.25 vCPU/0.5 GiB, una IP pública, RDS Single-AZ y tráfico bajo.
Las cuotas consultadas no implican que estos recursos sean gratuitos.

| Recurso                       |   USD/h aproximados |                       USD/mes aproximados |
| ----------------------------- | ------------------: | ----------------------------------------: |
| ALB interno, 1                |       0.02250 + LCU |      16.43 + 0 a 5.84 por 0 a 1 LCU medio |
| Fargate Linux x86, 1 tarea    |             0.01235 |                                      9.01 |
| IPv4 pública de la tarea      |             0.00500 |                                      3.65 |
| PostgreSQL `db.t4g.micro`     |             0.01600 |                                     11.68 |
| RDS gp3, 20 GiB               | 0.00315 equivalente |                                      2.30 |
| Secrets Manager, 2 secretos   | 0.00110 equivalente |                          0.80 + consultas |
| HTTP API                      |     Por solicitudes |             ~0.10 por 100 000 solicitudes |
| S3, ECR y CloudWatch (7 días) |             Por uso |                            Reservar 1 a 3 |
| CloudFront y transferencia    |   Por uso y destino | Reservar 0 a 3 con <=10 GB y tráfico bajo |

Base: **~USD 44/mes más uso**; reservar **USD 45–55/mes (~0.06–0.08/h)**
para esta demo de bajo tráfico. Con cero tareas sigue habiendo ~USD 31/mes
de ALB, RDS, almacenamiento y secretos. VPC, IGW, SG y VPC Link de HTTP API
no añaden NAT ni endpoints privados pagados. Transferencia entre AZ, backups
excedentes, créditos CPU de RDS y más tráfico pueden aumentar la cifra.
No es un tope de facturación. No asumir exenciones legacy de 750 horas.

Los USD 100 verificados son créditos, no un presupuesto mensual. Mantener el
plan FREE: AWS no factura hasta cambiar a PAID, y cierra el plan al agotarse los
créditos o vencer. No se automatiza ni autoriza ese cambio. El límite personal
de USD 10 fuera de créditos no está implementado como hard cap; requiere
supervisión y eliminación antes de agotar créditos. No activar servicios
excluidos del plan. Una prueba de 24 h consumiría aproximadamente USD 1.5–2.

Fuentes: [Fargate](https://aws.amazon.com/fargate/pricing/),
[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/),
[RDS](https://aws.amazon.com/rds/postgresql/pricing/),
[API Gateway](https://aws.amazon.com/api-gateway/pricing/),
[IPv4/transferencia](https://aws.amazon.com/vpc/pricing/),
[plan FREE](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html).

## Eliminar la demo

Solo cuando la evaluación haya terminado y se autorice borrar los datos:
poner `desired_count=0` mediante un plan revisado, esperar/parar también las
tareas puntuales y exportar cualquier dato que deba conservarse. RDS está
configurado **sin snapshot final**: destroy elimina la base de esta demo.
Vaciar explícitamente el bucket de SPA y borrar imágenes del repositorio ECR
exactos obtenidos de outputs; ambos bloquean destroy si contienen archivos.
Revisar `terraform plan -destroy` y ejecutar `terraform destroy` únicamente
después de esa revisión. CloudFront puede tardar varios minutos en eliminarse.
El secreto de aplicación conserva 7 días de recuperación; no reutilizar el nombre
mientras su eliminación esté pendiente. RDS elimina su secreto administrado.
Revisar consola para snapshots/manuales, tareas, interfaces y cargos residuales.
Nunca borrar ni manipular el PostgreSQL local de desarrollo para este proceso.
