import { registerConnectionTools } from './connection.js';
import { registerRequestTools } from './requests.js';
import { registerQueryTools } from './queries.js';
import { registerLogTools } from './logs.js';
import { registerExceptionTools } from './exceptions.js';
import { registerTimelineTools } from './timeline.js';
import { registerLaravelTools } from './laravel.js';
import { registerCursorTools } from './cursor.js';
import { registerSourceTools } from './source.js';
export function registerAllTools(server) {
    registerConnectionTools(server);
    registerRequestTools(server);
    registerQueryTools(server);
    registerLogTools(server);
    registerExceptionTools(server);
    registerTimelineTools(server);
    registerLaravelTools(server);
    registerCursorTools(server);
    // Source-code-aware debugging (read files, fix issues, auto-debug)
    registerSourceTools(server);
}
//# sourceMappingURL=index.js.map