import { CatalogBuilder } from '@backstage/plugin-catalog-backend';
import { ScaffolderEntitiesProcessor } from '@backstage/plugin-catalog-backend-module-scaffolder-entity-model';
import { Router } from 'express';
import { PluginEnvironment } from '../types';
import {
  GithubEntityProvider,
  GithubOrgEntityProvider
} from '@backstage/plugin-catalog-backend-module-github';

export default async function createPlugin(
    env: PluginEnvironment,
): Promise<Router> {
  const builder = await CatalogBuilder.create(env);
  builder.addEntityProvider(
      GithubEntityProvider.fromConfig(env.config, {
        logger: env.logger,
        scheduler: env.scheduler,
      }),
      GithubOrgEntityProvider.fromConfig(env.config, {
        id: 'github-org-provider',
        orgUrl: 'https://github.com/my-backstage-demo',
        logger: env.logger,
        schedule: env.scheduler.createScheduledTaskRunner({
          frequency: { minutes: 10 },
          timeout: { minutes: 5 },
        }),
      }),
  );
  builder.addProcessor(new ScaffolderEntitiesProcessor());
  const { processingEngine, router } = await builder.build();
  await processingEngine.start();
  return router;
}
