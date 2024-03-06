import * as aws from "@pulumi/aws";
import * as docker from "@pulumi/docker";
import {local} from "@pulumi/command";

const repository = new aws.ecr.Repository("backstage-repository", {
    name: "backstage",
    forceDelete: true,
});

const registryInfo = repository.registryId.apply(async id => {
    const credentials = await aws.ecr.getCredentials({registryId: id});
    const decodedCredentials = Buffer.from(credentials.authorizationToken, "base64").toString();
    const [username, password] = decodedCredentials.split(":");
    if (!password || !username) {
        throw new Error("Invalid credentials");
    }
    return {
        server: credentials.proxyEndpoint,
        username: username,
        password: password,
    };
});


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
    imageName: repository.repositoryUrl,
    registry: registryInfo,
}, {
    dependsOn: [
        backstageBuild
    ]
});

export const imageName = image.repoDigest;
