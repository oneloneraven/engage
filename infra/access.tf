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
  account_id       = var.cloudflare_account_id
  name             = "Engage"
  domain           = "engage.${var.app_zone_name}"
  type             = "self_hosted"
  session_duration = "8h"

  # Pinned so a login method added to the account later, such as a one-time PIN, never opens the admin host.
  allowed_idps              = [var.access_login_method_id]
  auto_redirect_to_identity = true

  enable_binding_cookie      = true
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"

  policies = [{
    id         = cloudflare_zero_trust_access_policy.owner.id
    precedence = 1
  }]
}
