module.exports = {
  apps: [{
    name: 'prayer-times',

    // Run tsx directly rather than through `npx`, and in fork mode rather than
    // cluster mode.
    //
    // The old config was `script: 'npx', args: 'tsx timings.ts'` in cluster
    // mode. pm2 captures stdout from the process it spawns, but that was
    // `npm exec`, and the real app ended up three processes below it:
    //
    //   npm exec tsx timings.ts
    //     └─ sh -c "tsx" timings.ts
    //         └─ node .../node_modules/.bin/tsx timings.ts
    //             └─ node ... timings.ts        <- the actual app
    //
    // So out.log and err.log stayed 0 bytes for nine months and there was no
    // way to diagnose anything. Cluster mode also bought nothing here: it is
    // for load-balancing HTTP servers, and this is a single-instance timer.
    script: './node_modules/.bin/tsx',
    args: 'timings.ts',
    exec_mode: 'fork',

    // Resolve node from PATH at spawn time rather than letting pm2 persist an
    // absolute path. pm2 stores exec_interpreter in its own saved state, so
    // without this it pins whichever nvm version was current when the app was
    // first added - and keeps using it after a Node upgrade, silently, until
    // that version is deleted and the scheduler stops starting.
    interpreter: 'node',

    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',

    // Restart daily at 03:00 as a backstop. The scheduler now re-arms its own
    // midnight timer and has a watchdog, so this should never be what saves
    // it - but a fresh process each morning costs nothing and bounds the blast
    // radius of any failure mode we have not thought of.
    cron_restart: '0 3 * * *',

    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
