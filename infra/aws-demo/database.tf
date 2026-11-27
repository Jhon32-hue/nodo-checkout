resource "aws_db_subnet_group" "demo" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "demo" {
  name_prefix = "${local.name}-"
  family      = "postgres17"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "demo" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "17"
  instance_class               = "db.t4g.micro"
  allocated_storage            = 20
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "payment_checkout"
  username                     = "nodo_admin"
  manage_master_user_password  = true
  db_subnet_group_name         = aws_db_subnet_group.demo.name
  parameter_group_name         = aws_db_parameter_group.demo.name
  vpc_security_group_ids       = [aws_security_group.database.id]
  publicly_accessible          = false
  multi_az                     = false
  port                         = 5432
  backup_retention_period      = 1
  auto_minor_version_upgrade   = true
  allow_major_version_upgrade  = false
  deletion_protection          = false
  skip_final_snapshot          = true
  copy_tags_to_snapshot        = true
  performance_insights_enabled = false
  # No password argument or secret-version data source: AWS generates the value.
}

resource "aws_secretsmanager_secret" "application" {
  name                    = "${local.name}/application"
  description             = "Populate outside Terraform before starting any task; no values in state"
  recovery_window_in_days = 7
}
