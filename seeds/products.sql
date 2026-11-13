INSERT INTO products (
  slug, name, domains, issue_repo, site_repo, site_dispatch_event,
  discord_secret, email_domain, email_aliases, context_schema, account_secret, thanks_url
) VALUES
  (
    'cl', 'Climbing Logbook',
    '["climbinglogbook.com","beta.climbinglogbook.com","my.climbinglogbook.com"]',
    'oneloneraven/climbing-logbook', NULL, NULL,
    'DISCORD_WEBHOOK_CL', 'climbinglogbook.com', '["hello","support"]',
    '{"reportedUsername":{"maxLength":64},"reportedEntryId":{"maxLength":64},"errorRef":{"maxLength":64}}',
    'ACCOUNT_SECRET_CL', 'https://climbinglogbook.com/feedback/thanks'
  ),
  (
    'deaftly', 'Deaftly',
    '["deaftly.com"]',
    'oneloneraven/deaftly', 'oneloneraven/deaftly-website', 'testimonials-changed',
    'DISCORD_WEBHOOK_DEAFTLY', 'deaftly.com', '["hello"]',
    '{}',
    'ACCOUNT_SECRET_DEAFTLY', 'https://deaftly.com/feedback/thanks/'
  );
