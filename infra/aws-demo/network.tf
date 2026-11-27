resource "aws_vpc" "demo" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "demo" {
  vpc_id = aws_vpc.demo.id
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.demo.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.demo.cidr_block, 8, count.index)
  tags              = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.demo.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(aws_vpc.demo.cidr_block, 8, count.index + 10)
  tags              = { Name = "${local.name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.demo.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.demo.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.demo.id
  # Local VPC routes only: no NAT gateway, Internet route or paid VPC endpoints.
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "link" {
  name_prefix = "${local.name}-link-"
  description = "API Gateway VPC Link ENIs"
  vpc_id      = aws_vpc.demo.id
}

resource "aws_security_group" "alb" {
  name_prefix = "${local.name}-alb-"
  description = "Internal ALB; accepts only VPC Link traffic"
  vpc_id      = aws_vpc.demo.id
}

resource "aws_security_group" "api" {
  name_prefix = "${local.name}-api-"
  description = "Fargate API; ingress only from internal ALB"
  vpc_id      = aws_vpc.demo.id
}

resource "aws_security_group" "database" {
  name_prefix = "${local.name}-db-"
  description = "Private PostgreSQL; accepts only API tasks"
  vpc_id      = aws_vpc.demo.id
}

resource "aws_vpc_security_group_egress_rule" "link_alb" {
  security_group_id            = aws_security_group.link.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_link" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.link.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_api" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "api_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "TLS to payment provider, ECR, Secrets Manager and CloudWatch"
}

resource "aws_vpc_security_group_egress_rule" "api_database" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "database_api" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
