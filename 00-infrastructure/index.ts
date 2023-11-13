import * as pulumi from "@pulumi/pulumi";
import * as scaleway from "@ediri/scaleway";
import * as k8s from "@pulumi/kubernetes";

import {ArgoCD} from "./argocd";
import {yaml} from "@pulumi/kubernetes";
import {readFileSync} from "fs";

const clusterConfig = new pulumi.Config("cluster")

const vpc = new scaleway.Vpc("scaleway-vpc")

const privateNetwork = new scaleway.VpcPrivateNetwork("scaleway-vpc", {
    ipv4Subnet: {
        subnet: "172.16.16.0/22",
    },
    vpcId: vpc.id,
})

const kapsule = new scaleway.K8sCluster("scaleway-cluster", {
    version: clusterConfig.require("version"),
    cni: "cilium",
    deleteAdditionalResources: true,
    tags: [
        "pulumi",
        "workshop",
    ],
    privateNetworkId: privateNetwork.id,
    autoUpgrade: {
        enable: clusterConfig.requireBoolean("auto_upgrade"),
        maintenanceWindowStartHour: 3,
        maintenanceWindowDay: "monday"
    },
});

const nodeConfig = new pulumi.Config("node")

const pool = new scaleway.K8sPool("scaleway-node-pool", {
    nodeType: nodeConfig.require("node_type"),
    size: nodeConfig.requireNumber("node_count"),
    autoscaling: nodeConfig.requireBoolean("auto_scale"),
    autohealing: nodeConfig.requireBoolean("auto_heal"),
    clusterId: kapsule.id,
});

export const kapsuleName = kapsule.name;
export const kapsuleVersion = kapsule.version;
export const kapsuleAutoUpgrade = kapsule.autoUpgrade.enable;
export const kapusuleNodeCount = pool.size;
export const kapsuleNodeType = pool.nodeType;
export const kapsuleID = kapsule.id;
export const region = kapsule.region;
export const kubeconfig = pulumi.secret(kapsule.kubeconfigs[0].configFile);

const k8sProvider = new k8s.Provider("k8s", {
    kubeconfig: kubeconfig,
    enableServerSideApply: true,
});

let initialObjects = new pulumi.asset.FileAsset("./argocd-initial-objects.yaml");


new ArgoCD("argocd", {
    initialObjects: initialObjects
}, {
    providers: {
        kubernetes: k8sProvider,
    },
    dependsOn: [
        kapsule,
        pool
    ]
})

const clusterSecretOperator = new k8s.helm.v3.Release("cluster-secret-operator", {
    chart: "cluster-secret",
    version: "0.2.1",
    repositoryOpts: {
        repo: "https://charts.clustersecret.io/",
    },
    namespace: "clustersecret",
    createNamespace: true,
}, {
    provider: k8sProvider,
    dependsOn:
        [
            kapsule,
            pool
        ]
});

const originalSecret = new k8s.core.v1.Secret("all-credentials", {
        metadata: {
            name: "all-credentials",
            namespace: clusterSecretOperator.namespace,
        },
        type: "Opaque",
        stringData: {
            "PULUMI_ACCESS_TOKEN": process.env.PULUMI_ACCESS_TOKEN || "",
            "SCW_ACCESS_KEY": process.env.SCW_ACCESS_KEY || "",
            "SCW_SECRET_KEY": process.env.SCW_SECRET_KEY || "",
            "K8S_CLUSTER_URL": kapsule.kubeconfigs[0].host,
            "K8S_CLUSTER_SA_TOKEN": kapsule.kubeconfigs[0].token,
            "GITHUB_TOKEN": process.env.GITHUB_TOKEN || "",
        }
    },
    {
        provider: k8sProvider,
        dependsOn:
            [
                kapsule,
                pool
            ]
    }
);

new k8s.apiextensions.CustomResource("clustersecret", {
    kind: "ClusterSecret",
    apiVersion: "clustersecret.io/v1",
    metadata: {
        name: "global-secret",
        namespace: clusterSecretOperator.namespace,
    },
    matchNamespace: [
        "backstage",
        "pulumi-operator",
    ],
    data: {
        valueFrom: {
            secretKeyRef: {
                name: originalSecret.metadata.name,
                namespace: originalSecret.metadata.namespace,
            }
        }
    }

}, {
    provider: k8sProvider,
    dependsOn:
        [
            clusterSecretOperator,
            kapsule,
            pool
        ]
});

