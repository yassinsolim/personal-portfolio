const path = require('path')
const fs = require('fs')
const { merge } = require('webpack-merge')
const commonConfiguration = require('./webpack.common.js')
const ip = require('ip')
const portFinderSync = require('portfinder-sync')

const shouldExportScene = process.env.EXPORT_SCENE === '1'

const infoColor = (_message) =>
{
    return `\u001b[1m\u001b[34m${_message}\u001b[39m\u001b[22m`
}

module.exports = merge(
    commonConfiguration,
    {
        stats: 'errors-warnings',
        mode: 'development',
        infrastructureLogging:
        {
            level: 'warn',
        },
        devServer:
        {
            host: 'local-ip',
            port: portFinderSync.getPort(8080),
            open: shouldExportScene ? '/?export=1&save=1' : true,
            https: false,
            allowedHosts: 'all',
            hot: false,
            watchFiles: ['src/**', 'static/**'],
            static:
            {
                watch: true,
                directory: path.join(__dirname, '../static')
            },
            client:
            {
                logging: 'none',
                overlay: true,
                progress: false
            },
            setupMiddlewares: (middlewares, devServer) =>
            {
                if (!devServer)
                {
                    throw new Error('webpack-dev-server is not defined')
                }

                devServer.app.post('/api/save-glb', (req, res) =>
                {
                    const chunks = []

                    req.on('data', (chunk) => chunks.push(chunk))
                    req.on('end', () =>
                    {
                        try
                        {
                            const buffer = Buffer.concat(chunks)
                            const exportDir = path.resolve(__dirname, '../exports')
                            const outputPath = path.join(exportDir, 'exported-scene.glb')

                            fs.mkdirSync(exportDir, { recursive: true })
                            fs.writeFileSync(outputPath, buffer)

                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify({ ok: true, bytes: buffer.length, path: outputPath }))
                        }
                        catch (error)
                        {
                            res.statusCode = 500
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify({ ok: false, error: error.message }))
                        }
                    })

                    req.on('error', (error) =>
                    {
                        res.statusCode = 500
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ ok: false, error: error.message }))
                    })
                })

                return middlewares
            },
            onAfterSetupMiddleware: function(devServer)
            {
                const port = devServer.options.port
                const https = devServer.options.https ? 's' : ''
                const localIp = ip.address()
                const domain1 = `http${https}://${localIp}:${port}`
                const domain2 = `http${https}://localhost:${port}`
                
                console.log(`Project running at:\n  - ${infoColor(domain1)}\n  - ${infoColor(domain2)}`)
            }
        }
    }
)
