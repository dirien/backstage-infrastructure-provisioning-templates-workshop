import * as pulumi from "@pulumi/pulumi";
import * as scaleway from "@ediri/scaleway";
import * as docker from "@pulumi/docker";
import {local} from "@pulumi/command";

const containerRegistry = new scaleway.RegistryNamespace("registry", {
    isPublic: true,
})

const backstageBuild = new local.Command("backstage-build", {
    dir: "./backstage",
    create: "yarn install && yarn tsc && yarn build:backend",
    update: "yarn install && yarn tsc && yarn build:backend",
});

// Build and publish the image.
const image = new docker.Image("backstage-image", {
    build: {
        context: "./backstage",
        platform: "linux/amd64",
        builderVersion: docker.BuilderVersion.BuilderBuildKit,
        dockerfile: "./backstage/packages/backend/Dockerfile",
    },
    imageName: containerRegistry.endpoint.apply(s => `${s}/backstage`),
    registry: {
        server: containerRegistry.endpoint,
        username: "nologin",
        password: process.env.SCW_SECRET_KEY,
    }
}, {
    dependsOn: [
        containerRegistry,
        backstageBuild
    ]
});

export const imageName = image.repoDigest;
