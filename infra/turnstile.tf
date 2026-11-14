# Covers every product site that posts web feedback to Engage, as listed in the products registry.
resource "cloudflare_turnstile_widget" "intake" {
  account_id = var.cloudflare_account_id
  name       = "engage-intake"
  # Sorted: Cloudflare returns it sorted, so any other order plans as a change.
  domains = sort(["climbinglogbook.com", "beta.climbinglogbook.com", "my.climbinglogbook.com", "deaftly.com"])
  mode    = "managed"

  # A replacement would change the secret, which is set by hand as a Worker secret.
  lifecycle {
    prevent_destroy = true
  }
}
