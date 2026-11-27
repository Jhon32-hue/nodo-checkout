resource "aws_lb" "api" {
  name                       = local.name
  internal                   = true
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.private[*].id
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "api" {
  name                 = local.name
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.demo.id
  deregistration_delay = 15
  health_check {
    path                = "/"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  protocol_type = "HTTP"
  # No CORS middleware: the browser calls /api on its CloudFront origin.
}

resource "aws_apigatewayv2_vpc_link" "api" {
  name               = local.name
  security_group_ids = [aws_security_group.link.id]
  subnet_ids         = aws_subnet.private[*].id
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  integration_uri        = aws_lb_listener.api.arn
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.api.id
  payload_format_version = "1.0"
  timeout_milliseconds   = 30000
  request_parameters = {
    "overwrite:path" = "$request.path"
  }
}

resource "aws_apigatewayv2_route" "api" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/nodo/${local.name}/gateway"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "api" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format = jsonencode({
      requestId = "$context.requestId"
      route     = "$context.routeKey"
      status    = "$context.status"
      latencyMs = "$context.responseLatency"
    })
  }
}
