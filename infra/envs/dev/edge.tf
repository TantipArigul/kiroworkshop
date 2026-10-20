# Edge (D5A-2, D5A-10, D5A-11): CloudFront is the single entry point; WAF inspects every request;
# the origin is the private EC2 instance through a CloudFront VPC origin.

# ---------- WAF (CLOUDFRONT scope, us-east-1) ----------

resource "aws_wafv2_web_acl" "portal" {
  provider = aws.us_east_1

  name        = local.name
  description = "Portal dev: AWS managed rules + per-IP rate limit"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 0

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # The Smart Checkup submission is a JSON body up to 64 KB (above the 8 KB rule limit);
        # the API enforces its own size limits.
        rule_action_override {
          name = "SizeRestrictions_BODY"

          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 3

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
    sampled_requests_enabled   = true
  }
}

resource "aws_cloudwatch_log_group" "waf" {
  provider = aws.us_east_1

  name              = local.waf_log_group
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.edge.arn
}

resource "aws_wafv2_web_acl_logging_configuration" "portal" {
  provider = aws.us_east_1

  resource_arn            = aws_wafv2_web_acl.portal.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # Session cookie, CSRF token and credentials never reach the WAF logs.
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }

  redacted_fields {
    single_header {
      name = "x-csrf-token"
    }
  }

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
}

# ---------- CloudFront ----------

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_vpc_origin" "portal" {
  vpc_origin_endpoint_config {
    name                   = local.name
    arn                    = aws_instance.portal.arn
    http_port              = 80
    https_port             = 443
    origin_protocol_policy = "http-only"

    origin_ssl_protocols {
      items    = ["TLSv1.2"]
      quantity = 1
    }
  }
}

resource "aws_cloudfront_distribution" "portal" {
  enabled         = true
  comment         = "${local.name} (deployment.md AWS dev)"
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_200"
  web_acl_id      = aws_wafv2_web_acl.portal.arn

  origin {
    origin_id   = "portal-ec2"
    domain_name = aws_instance.portal.private_dns

    vpc_origin_config {
      vpc_origin_id            = aws_cloudfront_vpc_origin.portal.id
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }
  }

  # SPA shell: never cached so a new deploy is visible immediately.
  default_cache_behavior {
    target_origin_id           = "portal-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  # API: every method, cookies, Origin and CSRF headers pass through; nothing is cached.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "portal-ec2"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  ordered_cache_behavior {
    path_pattern             = "/health*"
    target_origin_id         = "portal-ec2"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  # Vite emits content-hashed file names under /assets/, so they can be cached at the edge.
  ordered_cache_behavior {
    path_pattern               = "/assets/*"
    target_origin_id           = "portal-ec2"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
