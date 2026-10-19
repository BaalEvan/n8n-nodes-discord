# Local dev n8n

This starts a throwaway n8n that loads the node from the release folder, the same way the server does.

Build the artifact from the repo root:

    npm run pack:custom

This writes `release/n8n-nodes-discord-<version>/` and a `.tar.gz` next to it. The compose file mounts the 0.5.0 folder, so update the path in `docker-compose.yml` if the version changes.

Start n8n:

    docker compose -f dev/docker-compose.yml up -d

Open http://localhost:5679 and create the owner account on first run. Stop it with:

    docker compose -f dev/docker-compose.yml down

Add `-v` to also delete the `n8n_dev_data` volume and start fresh.

The test bot token goes into an n8n credential ("Discord Gateway Bot API") that you create in the UI. Never put it in a file in this repo.

n8n reads custom nodes only at startup. After each rebuild, run:

    docker compose -f dev/docker-compose.yml restart
