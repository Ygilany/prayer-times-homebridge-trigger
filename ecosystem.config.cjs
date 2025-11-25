module.exports = {
  apps: [{
    name: 'prayer-times',
    script: 'npx',
    args: 'tsx timings.ts',
    interpreter: 'node',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};

