data "cloudflare_zero_trust_access_identity_providers" "all" {
  account_id = var.cloudflare_account_id
}

locals {
  # Signing in with the Cloudflare account carries that account's MFA; pinning it stops a later login method, such as a one-time PIN, opening the admin host.
  cloudflare_login_id = one([for idp in data.cloudflare_zero_trust_access_identity_providers.all.result : idp.id if idp.type == "cloudflare"])
}

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id = var.cloudflare_account_id
  name       = "Allow the Engage owner"
  decision   = "allow"

  include = [{
    email = {
      email = var.owner_email
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "admin" {
  account_id                = var.cloudflare_account_id
  name                      = "Engage"
  domain                    = "engage.${var.app_zone_name}"
  type                      = "self_hosted"
  session_duration          = "8h"
  allowed_idps              = [local.cloudflare_login_id]
  auto_redirect_to_identity = true

  policies = [{
    id         = cloudflare_zero_trust_access_policy.owner.id
    precedence = 1
  }]

  lifecycle {
    precondition {
      condition     = local.cloudflare_login_id != null
      error_message = "The account has no Cloudflare login method in Access, which the admin host relies on for MFA."
    }
  }
}
