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

# Adopted by the central identity stack (coraxia) without being destroyed; see #40.
removed {
  from = cloudflare_zero_trust_access_application.admin
}
