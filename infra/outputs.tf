output "app_dnssec_ds_record" {
  description = "The zone's DS record. Cloudflare Registrar publishes it to the registry itself."
  value       = cloudflare_zone_dnssec.app.ds
}

output "d1_database_id" {
  description = "Copied into wrangler.jsonc's d1_databases binding."
  value       = cloudflare_d1_database.engage.id
}

output "access_aud" {
  description = "The admin Access application's audience tag, set as ACCESS_AUD for the Worker to check every admin request's token against."
  value       = cloudflare_zero_trust_access_application.admin.aud
}

output "turnstile_sitekey" {
  description = "Embedded in each product's feedback form. Not secret."
  value       = cloudflare_turnstile_widget.intake.sitekey
}

output "turnstile_secret" {
  description = "Piped into `wrangler secret put TURNSTILE_SECRET_KEY --env production` with `tofu output -raw turnstile_secret`, never displayed."
  value       = cloudflare_turnstile_widget.intake.secret
  sensitive   = true
}
