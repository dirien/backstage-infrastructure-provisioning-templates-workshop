import * as pulumi from "@pulumi/pulumi";
import * as eks from "@pulumi/eks";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";

import {ArgoCD} from "./argocd";

// Grab some values from the Pulumi configuration (or use default values)
const config = new pulumi.Config();
const minClusterSize = config.getNumber("minClusterSize") || 3;
const maxClusterSize = config.getNumber("maxClusterSize") || 6;
const desiredClusterSize = config.getNumber("desiredClusterSize") || 3;
const eksNodeInstanceType = config.get("eksNodeInstanceType") || "t3.medium";
const vpcNetworkCidr = config.get("vpcNetworkCidr") || "10.0.0.0/16";

const publicSubnetCIDRs: pulumi.Input<string>[] = config.requireObject("publicSubnetCIDRs") || [
    "10.0.0.0/20",
    "10.0.0.32/20"
];

const availabilityZones: pulumi.Input<string>[] = config.requireObject("availabilityZones") || [
    "eu-central-1a",
    "eu-central-1b"
];

// Create a new VPC
const eksVpc = new aws.ec2.Vpc("eks-vpc", {
    enableDnsHostnames: true,
    cidrBlock: vpcNetworkCidr,
});

// Create an Internet Gateway and Route Table for the public subnets
const eksInternetGateway = new aws.ec2.InternetGateway("eks-igw", {
    vpcId: eksVpc.id,
});

const eksRouteTable = new aws.ec2.RouteTable("eks-rt", {
    vpcId: eksVpc.id,
    routes: [{
        cidrBlock: "0.0.0.0/0",
        gatewayId: eksInternetGateway.id,
    }],
});

let publicSubnetIDs: pulumi.Input<string>[] = [];

// Create the public subnets and route table associations
for (let i = 0; i < availabilityZones.length; i++) {
    const publicSubnet = new aws.ec2.Subnet(`eks-public-subnet-${i}`, {
        vpcId: eksVpc.id,
        mapPublicIpOnLaunch: false,
        assignIpv6AddressOnCreation: false,
        cidrBlock: publicSubnetCIDRs[i],
        availabilityZone: availabilityZones[i],
        tags: {
            Name: `eks-public-subnet-${i}`,
        }
    });

    publicSubnetIDs.push(publicSubnet.id);

    new aws.ec2.RouteTableAssociation(`eks-rt-association-${i}`, {
        subnetId: publicSubnet.id,
        routeTableId: eksRouteTable.id,
    });
}

// Create the EKS cluster
const cluster = new eks.Cluster("eks-cluster", {
    vpcId: eksVpc.id,
    privateSubnetIds: publicSubnetIDs,
    instanceType: eksNodeInstanceType,
    desiredCapacity: desiredClusterSize,
    minSize: minClusterSize,
    maxSize: maxClusterSize,
    endpointPrivateAccess: false,
    endpointPublicAccess: true,
    createOidcProvider: true,
    nodeRootVolumeSize: 150,
    authenticationMode: "API",
});

const podIdentityAddon = new aws.eks.Addon("pod-identity", {
    clusterName: cluster.eksCluster.name,
    addonName: "eks-pod-identity-agent",
    addonVersion: "v1.3.0-eksbuild.1",
    resolveConflictsOnCreate: "OVERWRITE",
    resolveConflictsOnUpdate: "OVERWRITE",
});

const accessEntry = new aws.eks.AccessEntry("accessEntry", {
    clusterName: cluster.eksCluster.name,
    principalArn: "arn:aws:iam::052848974346:role/aws-reserved/sso.amazonaws.com/us-west-2/AWSReservedSSO_AdministratorAccess_5b5d58a7c435da2d"
});

const accessEntryPolicyClusterAdmin = new aws.eks.AccessPolicyAssociation("accessEntryPolicyClusterAdmin", {
    accessScope: {
        type: "cluster"
    },
    clusterName: cluster.eksCluster.name,
    principalArn: "arn:aws:iam::052848974346:role/aws-reserved/sso.amazonaws.com/us-west-2/AWSReservedSSO_AdministratorAccess_5b5d58a7c435da2d",
    policyArn: "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
});


const ecrRole = new aws.iam.Role("argocd-argocd-image-updater-role", {
    assumeRolePolicy: {
        Version: "2012-10-17",
        Statement: [{
            Action: [
                "sts:AssumeRole",
                "sts:TagSession"
            ],
            Effect: "Allow",
            Principal: {
                Service: "pods.eks.amazonaws.com",
            },
        }],
    },
});

const ecrPolicy = new aws.iam.Policy("argocd-argocd-image-updater-policy", {
    policy: aws.iam.getPolicyDocument({
        version: "2012-10-17",
        statements: [{
            actions: [
                "ecr:*"
            ],
            resources: [
                "*",
            ],
            effect: "Allow",
        }],
    }).then(policy => policy.json),
})

const ecrRolePolicy = new aws.iam.RolePolicyAttachment("argocd-argocd-image-updater-policy-attachment", {
    role: ecrRole,
    policyArn: ecrPolicy.arn,
});

new aws.eks.PodIdentityAssociation("argocd-argocd-image-updater-pod-identity-association", {
    clusterName: cluster.eksCluster.name,
    roleArn: ecrRole.arn,
    namespace: "argocd",
    serviceAccount: "argocd-argocd-image-updater",
});

// Export some values for use elsewhere
export const kubeconfig = pulumi.secret(cluster.kubeconfig);

const k8sProvider = new k8s.Provider("k8s", {
    kubeconfig: cluster.kubeconfigJson,
    enableServerSideApply: true,
});

let initialObjects = new pulumi.asset.FileAsset("./argocd-initial-objects.yaml");

const argocd = new ArgoCD("argocd", {
    initialObjects: initialObjects
}, {
    providers: {
        kubernetes: k8sProvider,
    },
})

// Retrieve the value of "myEnvironment" from the Pulumi Config
const pulumipat = config.get("pulumi-pat");

const originalSecret = new k8s.core.v1.Secret("all-credentials", {
        metadata: {
            name: "pulumi-access-token",
            namespace: argocd.namespace,
        },
        type: "Opaque",
        stringData: {
            "PULUMI_ACCESS_TOKEN": pulumipat || ""
        }
    },
    {
        provider: k8sProvider,
    }
);
