import * as cdk from "aws-cdk-lib";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { SSM_SECRETS } from "./ssm-params.js";

const SECRET_PARAMS = [
  { id: "BridgeAuthToken", path: SSM_SECRETS.BRIDGE_AUTH_TOKEN, desc: "Bridge auth token" },
  { id: "OpenclawGatewayToken", path: SSM_SECRETS.OPENCLAW_GATEWAY_TOKEN, desc: "OpenClaw Gateway token" },
  { id: "AnthropicApiKey", path: SSM_SECRETS.ANTHROPIC_API_KEY, desc: "Anthropic API key" },
  { id: "TelegramBotToken", path: SSM_SECRETS.TELEGRAM_BOT_TOKEN, desc: "Telegram bot token" },
  { id: "TelegramWebhookSecret", path: SSM_SECRETS.TELEGRAM_WEBHOOK_SECRET, desc: "Telegram webhook secret" },
] as const;

export interface SecretsStackProps extends cdk.StackProps {
  aiProvider?: string;
}

export class SecretsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: SecretsStackProps) {
    super(scope, id, props);

    const isBedrock = props?.aiProvider === "bedrock";

    for (const { id: paramId, path, desc } of SECRET_PARAMS) {
      if (isBedrock && paramId === "AnthropicApiKey") {
        continue;
      }
      const cfnParam = new cdk.CfnParameter(this, paramId, {
        type: "String",
        noEcho: true,
        description: desc,
      });

      new cr.AwsCustomResource(this, `${paramId}Param`, {
        onCreate: {
          service: "SSM",
          action: "putParameter",
          parameters: {
            Name: path,
            Type: "SecureString",
            Value: cfnParam.valueAsString,
          },
          physicalResourceId: cr.PhysicalResourceId.of(path),
        },
        onUpdate: {
          service: "SSM",
          action: "putParameter",
          parameters: {
            Name: path,
            Type: "SecureString",
            Value: cfnParam.valueAsString,
            Overwrite: true,
          },
          physicalResourceId: cr.PhysicalResourceId.of(path),
        },
        onDelete: {
          service: "SSM",
          action: "deleteParameter",
          parameters: {
            Name: path,
          },
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["ssm:PutParameter", "ssm:DeleteParameter"],
            resources: [
              `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter${path}`,
            ],
          }),
        ]),
      });
    }
  }
}
