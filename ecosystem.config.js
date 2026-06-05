// PM2 ecosystem config for Mac mini production deployment
// Manages the Next.js app server and a scheduled cron job running 24/7.

module.exports = {
  apps: [
    {
      name: "pathway-agent",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/Users/shojiyuya/Desktop/仕事/パスウェイ/案件/agent-command-center",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      out_file: "logs/out.log",
      error_file: "logs/err.log",
      max_memory_restart: "512M",
    },
    {
      name: "scout-cron",
      script: "scripts/run-cron.sh",
      cron_restart: "0 6,18 * * *",
      autorestart: false,
      watch: false,
    },
    {
      name: "learn-cron",
      script: "scripts/run-learn-cron.sh",
      cron_restart: "0 7,19 * * *",
      autorestart: false,
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
