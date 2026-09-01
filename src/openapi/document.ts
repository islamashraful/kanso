import { createDocument } from 'zod-openapi';

import { attachmentPaths } from '@/modules/attachments/attachments.openapi';
import { authPaths } from '@/modules/auth/auth.openapi';
import { organizationPaths } from '@/modules/organizations/organizations.openapi';
import { projectPaths } from '@/modules/projects/projects.openapi';
import { taskPaths } from '@/modules/tasks/tasks.openapi';

import { BEARER_AUTH } from './components';

/**
 * Builds the OpenAPI document from the same Zod schemas that validate
 * requests, so the reference cannot describe a contract the API does not
 * enforce. See docs/adr/0005 and docs/adr/0015.
 *
 * A function rather than a module-level constant: building it is work, and
 * when it happens is the composition root's decision, not this module's.
 */
export const buildOpenApiDocument = () =>
  createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Kanso API',
      version: '1.0.0',
      // Leads with the deployment status because the hosted copy of this
      // reference has no API behind it: the page offers to send requests, and
      // without this it would be offering to send them nowhere.
      description: [
        'Nothing is deployed. This describes an API that runs locally: start it with `bun run dev` and the endpoints answer on `http://localhost:3000`. Requests sent from this page reach an instance you are running yourself, or nothing at all.',
        'Multi-tenant task and project management. A request carries an access token for identity and, on organization-scoped routes, an `x-org-id` header naming the tenant — which is trusted only once a membership row proves the caller belongs to it.',
      ].join('\n\n'),
    },
    // Applied to every path that does not override it. The four auth paths
    // override it with `security: []`, being how the token is obtained.
    security: [{ [BEARER_AUTH]: [] }],
    components: {
      securitySchemes: {
        [BEARER_AUTH]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token from `POST /api/v1/auth/login`. Identity only.',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Register, log in, rotate and revoke tokens.' },
      { name: 'Organizations', description: 'Tenants. Created before anything else.' },
      { name: 'Projects', description: 'Containers for tasks, scoped to one organization.' },
      { name: 'Tasks', description: 'Units of work, scoped to one organization.' },
      { name: 'Attachments', description: 'Files uploaded directly to S3 and attached to a task.' },
    ],
    paths: {
      ...authPaths,
      ...organizationPaths,
      ...projectPaths,
      ...taskPaths,
      ...attachmentPaths,
    },
  });
