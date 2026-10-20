# Network (D5A-2, D5A-3): one private subnet, no NAT, no public IPs. AWS APIs are reached through
# VPC endpoints; the only inbound path is CloudFront (VPC origin) on :80.

locals {
  name         = "${var.prefix}-${var.environment}-portal"
  param_prefix = "/${var.prefix}/${var.environment}/portal"

  interface_endpoints = toset([
    "ecr.api",
    "ecr.dkr",
    "ssm",
    "ssmmessages",
    "ec2messages",
    "logs",
    "secretsmanager",
  ])
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.prefix}-${var.environment}-vpc" }
}

# Required by CloudFront VPC origins to mark the VPC as internet-reachable; no route uses it.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.prefix}-${var.environment}-igw" }
}

resource "aws_subnet" "private" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.private_subnet_cidr
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = false

  tags = { Name = "${var.prefix}-${var.environment}-private-a" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.prefix}-${var.environment}-private" }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

# Lock down the default security group so nothing can use it by accident.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${var.prefix}-${var.environment}-default-locked" }
}

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

data "aws_ec2_managed_prefix_list" "s3" {
  name = "com.amazonaws.${var.region}.s3"
}

resource "aws_security_group" "instance" {
  name        = "${local.name}-instance"
  description = "Portal EC2: HTTP from CloudFront only; HTTPS to VPC endpoints and S3"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-instance" }
}

resource "aws_vpc_security_group_ingress_rule" "instance_http_from_cloudfront" {
  security_group_id = aws_security_group.instance.id
  description       = "Caddy :80 from CloudFront origin-facing servers"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "instance_to_endpoints" {
  security_group_id            = aws_security_group.instance.id
  description                  = "AWS APIs through interface endpoints"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.endpoints.id
}

resource "aws_vpc_security_group_egress_rule" "instance_to_s3" {
  security_group_id = aws_security_group.instance.id
  description       = "ECR layers and AL2023 repositories through the S3 gateway endpoint"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.s3.id
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "Interface endpoints: HTTPS from the portal instance only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-endpoints" }
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_instance" {
  security_group_id            = aws_security_group.endpoints.id
  description                  = "HTTPS from the portal instance"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.instance.id
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [aws_subnet.private.id]
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true

  tags = { Name = "${local.name}-${replace(each.value, ".", "-")}" }
}

data "aws_iam_policy_document" "s3_endpoint" {
  statement {
    sid     = "EcrLayersAndAmazonLinuxRepos"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::prod-${var.region}-starport-layer-bucket/*",
      "arn:aws:s3:::al2023-repos-${var.region}-de612dc2/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
  policy            = data.aws_iam_policy_document.s3_endpoint.json

  tags = { Name = "${local.name}-s3" }
}
