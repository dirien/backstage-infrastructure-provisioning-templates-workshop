FROM --platform=linux/amd64 pulumi/pulumi:3.91.1

RUN <<EOF
apt install -y bash-completion vim

## Set bash completion for pulumi
pulumi gen-completion bash >> /etc/bash_completion.d/pulumi

## Install LocalStack CLI
curl -o /usr/local/bin/scw -L "https://github.com/scaleway/scaleway-cli/releases/download/v2.24.0/scaleway-cli_2.24.0_linux_amd64"
chmod +x /usr/local/bin/scw
EOF
