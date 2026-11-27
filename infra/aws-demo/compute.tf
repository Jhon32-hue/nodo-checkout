resource "aws_ecr_repository" "api" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
  # Explicitly remove images before destroy; never silently remove deployed artifacts.
  force_delete = false
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/nodo/${local.name}/api"
  retention_in_days = 7
}

resource "aws_iam_role" "execution" {
  name = "${local.name}-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets" {
  name = "runtime-secrets-only"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.application.arn,
        aws_db_instance.demo.master_user_secret[0].secret_arn
      ]
    }]
  })
}

resource "aws_ecs_cluster" "demo" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "api"
    image                  = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
    essential              = true
    readonlyRootFilesystem = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "DB_HOST", value = aws_db_instance.demo.address },
      { name = "DB_PORT", value = "5432" },
      { name = "DB_NAME", value = aws_db_instance.demo.db_name },
      { name = "PGSSLMODE", value = "verify-full" },
      { name = "FRONTEND_ORIGINS", value = "https://${aws_cloudfront_distribution.spa.domain_name}" },
      { name = "WOMPI_BASE_URL", value = "https://api-sandbox.co.uat.wompi.dev/v1" }
    ]
    secrets = concat([
      { name = "DB_USER", valueFrom = "${aws_db_instance.demo.master_user_secret[0].secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.demo.master_user_secret[0].secret_arn}:password::" }
      ], [for key in ["CSRF_SECRET", "WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_INTEGRITY_SECRET"] : {
        name      = key
        valueFrom = "${aws_secretsmanager_secret.application.arn}:${key}::"
    }])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.api.name
        awslogs-region        = "us-east-2"
        awslogs-stream-prefix = "api"
      }
    }
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 45
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                               = local.name
  cluster                            = aws_ecs_cluster.demo.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }
  depends_on = [
    aws_lb_listener.api,
    aws_iam_role_policy_attachment.execution,
    aws_iam_role_policy.secrets,
    aws_route_table_association.public,
    aws_vpc_security_group_ingress_rule.api_alb,
    aws_vpc_security_group_ingress_rule.database_api,
    aws_vpc_security_group_egress_rule.api_https,
    aws_vpc_security_group_egress_rule.api_database
  ]
}
