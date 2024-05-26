const { readFileSync } = require('fs');
    const { builder } = require('@netlify/functions');
    const { getPagePathFromPageDataPath, getGraphQLEngine, prepareFilesystem, getErrorResponse } = require('./utils')
    const { join, resolve } = require("path");
    const etag = require('etag');
    const pageRoot = resolve(__dirname, "../../..");
    exports.handler = builder(((renderMode, appDir) => {
    process.chdir(appDir);
    const DATA_SUFFIX = '/page-data.json';
    const DATA_PREFIX = '/page-data/';
    const cacheDir = join(appDir, '.cache');
    // Requiring this dynamically so esbuild doesn't re-bundle it
    const { getData, renderHTML, renderPageData } = require(join(cacheDir, 'page-ssr'));
    let graphqlEngine;
    return async function handler(event) {
        if (!graphqlEngine) {
            await prepareFilesystem(cacheDir, event.rawUrl);
            graphqlEngine = getGraphQLEngine(cacheDir);
        }
        // Gatsby expects cwd to be the site root
        process.chdir(appDir);
        const eventPath = event.path;
        const isPageData = eventPath.endsWith(DATA_SUFFIX) && eventPath.startsWith(DATA_PREFIX);
        const pathName = isPageData
            ? getPagePathFromPageDataPath(eventPath)
            : eventPath;
        // Gatsby doesn't currently export this type.
        const page = graphqlEngine.findPageByPath(pathName);
        if ((page === null || page === void 0 ? void 0 : page.mode) !== renderMode) {
            return getErrorResponse({ statusCode: 404, renderMode });
        }
        const req = renderMode === 'SSR'
            ? {
                query: event.queryStringParameters,
                method: event.httpMethod,
                url: event.path,
                headers: event.headers,
            }
            : {
                query: {},
                method: 'GET',
                url: event.path,
                headers: {},
            };
        console.log(`[${req.method}] ${event.path} (${renderMode})`);
        try {
            const data = await getData({
                pathName,
                graphqlEngine,
                req,
            });
            if (isPageData) {
                const body = JSON.stringify(await renderPageData({ data }));
                return {
                    statusCode: 200,
                    body,
                    headers: {
                        ETag: etag(body),
                        'Content-Type': 'application/json',
                        'X-Render-Mode': renderMode,
                        ...data.serverDataHeaders,
                    },
                };
            }
            const body = await renderHTML({ data });
            return {
                statusCode: 200,
                body,
                headers: {
                    ETag: etag(body),
                    'Content-Type': 'text/html; charset=utf-8',
                    'X-Render-Mode': renderMode,
                    ...data.serverDataHeaders,
                },
            };
        }
        catch (error) {
            return getErrorResponse({ error, renderMode });
        }
    };
})("DSG", pageRoot))