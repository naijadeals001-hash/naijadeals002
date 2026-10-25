module.exports = {
  apps: [
    {
      name: 'naijadeals',
      script: 'npx',
      args: 'wrangler pages dev dist --d1=naijadeals-production --local --ip 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      // Prevent platform/provider credentials inherited by PM2 from reaching Wrangler/workerd.
      // Application-local development secrets continue to come from the project's .dev.vars.
      filter_env: ['GSK_', 'GENSPARK_', 'OPENAI_', 'ANTHROPIC_'],
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
