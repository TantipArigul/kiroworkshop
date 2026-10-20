# Keys, identities, secrets and configuration (D5A-4, D5A-5, D5A-8, D5A-9).

data "aws_caller_identity" "current" {}

locals {
  account_id     = data.aws_caller_identity.current.account_id
  log_group_arn  = "arn:aws:logs:${var.region}:${local.account_id}:log-group:${local.param_prefix}"
  waf_log_group  = "aws-waf-logs-${local.name}"
  github_subject = "ref:refs/heads/${var.github_deploy_branch}"
  github_owner   = split("/", var.github_repository)[0]
  github_repo    = split("/", var.github_repository)[1]
}

# ---------- KMS ----------

data "aws_iam_policy_document" "kms_main" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid = "CloudWatchLogsForPortalLogGroups"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["${local.log_group_arn}/*"]
    }
  }

  statement {
    sid       = "AlarmAndBudgetNotificationsToEncryptedTopic"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.name}: EBS, snapshots, Secrets Manager, CloudWatch Logs, ECR, SNS"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_main.json
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

data "aws_iam_policy_document" "kms_edge" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid = "CloudWatchLogsForWafLogGroup"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.us-east-1.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:us-east-1:${local.account_id}:log-group:${local.waf_log_group}"]
    }
  }
}

resource "aws_kms_key" "edge" {
  provider = aws.us_east_1

  description             = "${local.name}: WAF logs (us-east-1)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.kms_edge.json
}

resource "aws_kms_alias" "edge" {
  provider = aws.us_east_1

  name          = "alias/${local.name}-edge"
  target_key_id = aws_kms_key.edge.key_id
}

# ---------- Secrets and configuration ----------

ephemeral "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "session" {
  name                    = "${var.prefix}/${var.environment}/portal/session-secret"
  description             = "SESSION_SECRET for the portal API (rotate: increase session_secret_version)"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7

  tags = { DataClassification = "Restricted" }
}

# Write-only: the value is generated per run but only sent when the version changes, and it is
# never stored in the plan or state.
resource "aws_secretsmanager_secret_version" "session" {
  secret_id                = aws_secretsmanager_secret.session.id
  secret_string_wo         = ephemeral.random_password.session_secret.result
  secret_string_wo_version = var.session_secret_version
}

resource "aws_ssm_parameter" "env" {
  name        = "${local.param_prefix}/env"
  description = "Non-secret API environment (one KEY=value per line)"
  type        = "String"
  tier        = "Standard"
  value = join("\n", concat(
    [for key in sort(keys(var.app_settings)) : "${key}=${var.app_settings[key]}"],
    ["ALLOWED_ORIGINS=https://${aws_cloudfront_distribution.portal.domain_name}"],
  ))
}

# container | host (variable api_run_mode); read by the deploy document on the instance.
resource "aws_ssm_parameter" "api_mode" {
  name        = "${local.param_prefix}/api-mode"
  description = "How the API runs: container (default) or host (Nextflow available)"
  type        = "String"
  tier        = "Standard"
  value       = var.api_run_mode
}

# Deployment coordinates read by scripts/aws/deploy-dev.sh (CI and operator).
resource "aws_ssm_parameter" "deploy" {
  for_each = {
    region       = var.region
    instance_id  = aws_instance.portal.id
    document     = aws_ssm_document.deploy.name
    url          = "https://${aws_cloudfront_distribution.portal.domain_name}"
    api_repo     = aws_ecr_repository.portal["api"].repository_url
    migrate_repo = aws_ecr_repository.portal["migrate"].repository_url
    web_repo     = aws_ecr_repository.portal["web"].repository_url
    log_group    = aws_cloudwatch_log_group.portal["deploy"].name
  }

  name  = "${local.param_prefix}/deploy/${each.key}"
  type  = "String"
  tier  = "Standard"
  value = each.value
}

# ---------- EC2 instance role ----------

data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "instance" {
  statement {
    sid = "SystemsManagerAgent"
    actions = [
      "ssm:UpdateInstanceInformation",
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
      "ec2messages:AcknowledgeMessage",
      "ec2messages:DeleteMessage",
      "ec2messages:FailMessage",
      "ec2messages:GetEndpoint",
      "ec2messages:GetMessages",
      "ec2messages:SendReply",
    ]
    # These actions do not support resource-level permissions.
    resources = ["*"]
  }

  statement {
    sid       = "RuntimeConfig"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.env.arn, aws_ssm_parameter.api_mode.arn]
  }

  statement {
    sid       = "SessionSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.session.arn]
  }

  statement {
    sid       = "DecryptSecretViaSecretsManager"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [for repository in aws_ecr_repository.portal : repository.arn]
  }

  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [for group in aws_cloudwatch_log_group.portal : "${group.arn}:*"]
  }

  statement {
    sid       = "SessionManagerChecksLogGroupEncryption"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role" "instance" {
  name               = "${local.name}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role_policy" "instance" {
  name   = "${local.name}-instance"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.instance.json
}

resource "aws_iam_instance_profile" "instance" {
  name = "${local.name}-instance"
  role = aws_iam_role.instance.name
}

# ---------- GitHub Actions deploy role (OIDC, temporary credentials) ----------

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only workflows running on the deploy branch of this repository (both sub claim formats).
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:${local.github_subject}",
        "repo:${local.github_owner}@${var.github_owner_id}/${local.github_repo}@${var.github_repository_id}:${local.github_subject}",
      ]
    }
  }
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushAndInspect"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeImageScanFindings",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repository in aws_ecr_repository.portal : repository.arn]
  }

  statement {
    sid     = "RunDeployDocumentOnPortalInstance"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_ssm_document.deploy.arn,
      aws_instance.portal.arn,
    ]
  }

  statement {
    sid     = "ReadCommandResults"
    actions = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
    # These actions do not support resource-level permissions.
    resources = ["*"]
  }

  statement {
    sid     = "ReadDeployCoordinates"
    actions = ["ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.param_prefix}/deploy",
      "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.param_prefix}/deploy/*",
    ]
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-deploy"
  description          = "GitHub Actions deploy-dev (OIDC, ${var.github_repository} ${var.github_deploy_branch})"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${local.name}-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# ---------- Data Lifecycle Manager role (daily snapshots) ----------

data "aws_iam_policy_document" "dlm_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${local.name}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_trust.json
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}
