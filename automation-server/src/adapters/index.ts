import { AdapterRegistry } from './base/registry.js';
import { createCareerPortalsAdapter } from './career-portals/index.js';
import { createCustomAdapter } from './custom/index.js';
import { createGlassdoorAdapter } from './glassdoor/index.js';
import { createIndeedAdapter } from './indeed/index.js';
import { LinkedInAdapter } from './linkedin/linkedInAdapter.js';
import { NaukriAdapter } from './naukri/naukriAdapter.js';

/**
 * Every platform TaskPilot knows. Adding a platform = writing an adapter and registering it here;
 * the API, queue, scheduler, history and UI pick it up from its descriptor.
 */
export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .register(new NaukriAdapter())
    .register(new LinkedInAdapter())
    .register(createIndeedAdapter())
    .register(createGlassdoorAdapter())
    .register(createCareerPortalsAdapter())
    .register(createCustomAdapter());
}
