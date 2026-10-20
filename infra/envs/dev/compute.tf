# Compute, data, operations and alerting (D5A-1, D5A-4, D5A-9, D5A-10, D5A-13, D5A-14).

locals {
  data_tags = {
    DataClassification = "Restricted"
    DataType           = "Synthetic"
  }

  log_groups = {
    app          = "${local.param_prefix}/app"
    deploy       = "${local.param_prefix}/deploy"
    ssm-sessions = "${local.param_prefix}/ssm-sessions"
  }

  ecr_image_pattern = {
    for key, repository in aws_ecr_repository.portal :
    key => "^(${replace(repository.repository_url, ".", "\\.")}@sha256:[0-9a-f]{64})?$"
  }

  host_script_lines = split("\n", trimspace(file("${path.module}/files/portal-host.sh")))
}

# ---------- Logs ----------

resource "aws_cloudwatch_log_group" "portal" {
  for_each = local.log_groups

  name              = each.value
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

# ---------- Instance and data volume ----------

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true
  kms_key_id        = aws_kms_key.main.arn

  tags = merge(local.data_tags, {
    Name   = "${local.name}-data"
    Backup = "${local.name}-daily"
  })

  # Holds the SQLite database, inputs, results and backups. Removing it is a deliberate
  # two-step action (infra/README.md §8).
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "portal" {
  ami                         = data.aws_ssm_parameter.al2023.insecure_value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.private.id
  vpc_security_group_ids      = [aws_security_group.instance.id]
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  associate_public_ip_address = false
  monitoring                  = false

  user_data = templatefile("${path.module}/files/user-data.sh", {
    data_volume_serial = replace(aws_ebs_volume.data.id, "-", "")
  })
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1 # containers cannot reach instance credentials
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    kms_key_id            = aws_kms_key.main.arn
    delete_on_termination = true
  }

  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = local.name }

  lifecycle {
    # A newer AMI or bootstrap script must not silently replace the instance; patching is in
    # infra/README.md §6.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.portal.id
  stop_instance_before_detaching = true
}

# ---------- Daily snapshots ----------

data "aws_iam_policy_document" "dlm_kms" {
  statement {
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey*",
      "kms:ReEncrypt*",
    ]
    resources = [aws_kms_key.main.arn]
  }

  statement {
    actions   = ["kms:CreateGrant"]
    resources = [aws_kms_key.main.arn]

    condition {
      test     = "Bool"
      variable = "kms:GrantIsForAWSResource"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role_policy" "dlm_kms" {
  name   = "${local.name}-dlm-kms"
  role   = aws_iam_role.dlm.id
  policy = data.aws_iam_policy_document.dlm_kms.json
}

resource "aws_dlm_lifecycle_policy" "data" {
  description        = "${local.name} daily data-volume snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags = {
      Backup = "${local.name}-daily"
    }

    schedule {
      name      = "daily"
      copy_tags = true

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["17:00"] # 00:00 Asia/Bangkok
      }

      retain_rule {
        count = var.snapshot_retention_count
      }
    }
  }
}

# ---------- Deploy / rollback document (Run Command) ----------

resource "aws_ssm_document" "deploy" {
  name            = "${local.name}-deploy"
  document_type   = "Command"
  document_format = "YAML"

  content = yamlencode({
    schemaVersion = "2.2"
    description   = "Deploy, roll back or set up Nextflow for the portal by image digest (deployment.md AWS dev)."
    parameters = {
      Action = {
        type          = "String"
        allowedValues = ["deploy", "rollback", "nextflow-setup"]
      }
      Sha = {
        type           = "String"
        default        = ""
        allowedPattern = "^([0-9a-f]{40})?$"
      }
      ApiImage = {
        type           = "String"
        default        = ""
        allowedPattern = local.ecr_image_pattern["api"]
      }
      MigrateImage = {
        type           = "String"
        default        = ""
        allowedPattern = local.ecr_image_pattern["migrate"]
      }
      WebImage = {
        type           = "String"
        default        = ""
        allowedPattern = local.ecr_image_pattern["web"]
      }
      RestoreDb = {
        type           = "String"
        default        = ""
        allowedPattern = "^(portal-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]{1,64}\\.db)?$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "portal"
      inputs = {
        timeoutSeconds = "1800"
        runCommand = concat(
          ["cat > /run/portal-host.sh <<'PORTAL_HOST_EOF'"],
          local.host_script_lines,
          [
            "PORTAL_HOST_EOF",
            "chmod 700 /run/portal-host.sh",
            "PORTAL_ACTION='{{ Action }}' PORTAL_SHA='{{ Sha }}' PORTAL_API_IMAGE='{{ ApiImage }}' PORTAL_MIGRATE_IMAGE='{{ MigrateImage }}' PORTAL_WEB_IMAGE='{{ WebImage }}' PORTAL_RESTORE_DB='{{ RestoreDb }}' PORTAL_REGION='${var.region}' PORTAL_ENV_PARAM='${aws_ssm_parameter.env.name}' PORTAL_MODE_PARAM='${aws_ssm_parameter.api_mode.name}' PORTAL_SECRET_ID='${aws_secretsmanager_secret.session.arn}' PORTAL_LOG_GROUP='${aws_cloudwatch_log_group.portal["app"].name}' bash /run/portal-host.sh",
            "rc=$?",
            "rm -f /run/portal-host.sh",
            "exit $rc",
          ],
        )
      }
    }]
  })
}

# Session Manager preferences for this account and region: shell sessions are streamed to an
# encrypted log group and time out when idle.
resource "aws_ssm_document" "session_preferences" {
  name            = "SSM-SessionManagerRunShell"
  document_type   = "Session"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "1.0"
    description   = "Session Manager preferences (${local.name})"
    sessionType   = "Standard_Stream"
    inputs = {
      s3BucketName                = ""
      s3KeyPrefix                 = ""
      s3EncryptionEnabled         = true
      cloudWatchLogGroupName      = aws_cloudwatch_log_group.portal["ssm-sessions"].name
      cloudWatchEncryptionEnabled = true
      cloudWatchStreamingEnabled  = true
      kmsKeyId                    = ""
      runAsEnabled                = false
      runAsDefaultUser            = ""
      idleSessionTimeout          = "20"
      maxSessionDuration          = "60"
      shellProfile = {
        windows = ""
        linux   = ""
      }
    }
  })
}

# ---------- Alerts ----------

resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = aws_kms_key.main.arn
}

data "aws_iam_policy_document" "alerts" {
  statement {
    sid       = "AlarmsAndBudgetsPublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

resource "aws_cloudwatch_metric_alarm" "system_status" {
  alarm_name          = "${local.name}-system-status"
  alarm_description   = "EC2 system status check failed: recover the instance (same ID, volumes and IP)"
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  dimensions          = { InstanceId = aws_instance.portal.id }
  alarm_actions = [
    "arn:aws:automate:${var.region}:ec2:recover",
    aws_sns_topic.alerts.arn,
  ]
  ok_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Account-wide (B1, 2026-10-20): this linked account cannot use cost-allocation tag filters until
  # the payer account activates the `Project` tag.

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  depends_on = [aws_sns_topic_policy.alerts]
}
