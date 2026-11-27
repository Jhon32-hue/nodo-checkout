resource "aws_s3_bucket" "spa" {
  bucket        = "${local.name}-${data.aws_caller_identity.current.account_id}-us-east-2"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "spa" {
  bucket                  = aws_s3_bucket.spa.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "spa" {
  bucket = aws_s3_bucket.spa.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

locals {
  spa_routes = {
    root   = "/"
    index  = "/index.html"
    assets = "/assets/{proxy+}"
    images = "/images/{proxy+}"
    fonts  = "/fonts/{proxy+}"
  }
}

data "archive_file" "spa" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.local/spa-lambda.zip"
}

resource "aws_cloudwatch_log_group" "spa" {
  name              = "/aws/lambda/${local.name}-spa"
  retention_in_days = 7
}

resource "aws_iam_role" "spa" {
  name = "${local.name}-spa"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "spa" {
  name = "read-spa-objects-only"
  role = aws_iam_role.spa.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          "${aws_s3_bucket.spa.arn}/index.html",
          "${aws_s3_bucket.spa.arn}/assets/*",
          "${aws_s3_bucket.spa.arn}/images/*",
          "${aws_s3_bucket.spa.arn}/fonts/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.spa.arn}:*"
      }
    ]
  })
}

resource "aws_lambda_function" "spa" {
  function_name    = "${local.name}-spa"
  role             = aws_iam_role.spa.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.spa.output_path
  source_code_hash = data.archive_file.spa.output_base64sha256
  timeout          = 10
  memory_size      = 128
  environment {
    variables = { SPA_BUCKET = aws_s3_bucket.spa.id }
  }
  # No VPC, secrets, database access, public function URL or S3 write permissions.
  depends_on = [aws_iam_role_policy.spa, aws_cloudwatch_log_group.spa]
}

resource "aws_apigatewayv2_integration" "spa" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.spa.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 12000
}

resource "aws_lambda_permission" "spa" {
  for_each      = local.spa_routes
  statement_id  = "HttpApi-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.spa.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/$default/GET${replace(each.value, "{proxy+}", "*")}"
}

resource "aws_apigatewayv2_route" "spa" {
  for_each  = local.spa_routes
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET ${each.value}"
  target    = "integrations/${aws_apigatewayv2_integration.spa.id}"
}
