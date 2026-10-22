module.exports = {
  apps: [{
    name: "photon-bot",
    script: "index.js",
    cwd: "/home/ubuntu/photon-bot",
    env_file: "/home/ubuntu/photon-bot/.env",
    restart_delay: 5000,
    max_restarts: 50,
    autorestart: true,
    out_file: "/home/ubuntu/photon-bot/out.log",
    error_file: "/home/ubuntu/photon-bot/err.log",
    time: true,
  }],
};
