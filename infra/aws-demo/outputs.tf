output "application_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}
output "swagger_url" {
  value = "${aws_apigatewayv2_api.api.api_endpoint}/docs"
}
output "openapi_url" {
  value = "${aws_apigatewayv2_api.api.api_endpoint}/docs-json"
}
output "spa_bucket" {
  value = aws_s3_bucket.spa.id
}
output "image_repository" {
  value = aws_ecr_repository.api.repository_url
}
output "application_secret_arn" {
  description = "Metadata only. Populate the value outside Terraform."
  value       = aws_secretsmanager_secret.application.arn
}
output "cluster_name" {
  value = aws_ecs_cluster.demo.name
}
output "service_name" {
  value = aws_ecs_service.api.name
}
output "maintenance_task" {
  description = "Non-secret settings for one-off migration/seed tasks using the same image."
  value = {
    cluster         = aws_ecs_cluster.demo.name
    task_definition = aws_ecs_task_definition.api.arn
    subnets         = aws_subnet.public[*].id
    security_group  = aws_security_group.api.id
  }
}
