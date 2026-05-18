const path = require('path')
const fs = require('fs')
const os = require('os')
const { merge } = require('webpack-merge')
const commonConfiguration = require('./webpack.common.js')
const portFinderSync = require('portfinder-sync')

const shouldExportScene = process.env.EXPORT_SCENE === '1'
const MAX_EXPORT_BYTES = 100 * 1024 * 1024
const devSecurityHeaders = {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: ws://127.0.0.1:8080 ws://localhost:8080; frame-src https://os.yassin.app http://localhost:3000; worker-src 'self' blob:; form-action 'self'; frame-ancestors 'none'"
}

const infoColor = (_message) =>
{
    return `\u001b[1m\u001b[34m${_message}\u001b[39m\u001b[22m`
}

const getLocalIpAddress = () =>
{
    const interfaces = os.networkInterfaces()
    for (const entries of Object.values(interfaces))
    {
        if (!entries)
        {
            continue
        }
        for (const entry of entries)
        {
            if (entry && entry.family === 'IPv4' && !entry.internal)
            {
                return entry.address
            }
        }
    }

    return '127.0.0.1'
}

module.exports = merge(
    commonConfiguration,
    {
        stats: 'errors-warnings',
        mode: 'development',
        devtool: 'source-map',
        infrastructureLogging:
        {
            level: 'warn',
        },
        devServer:
        {
            host: '127.0.0.1',
            port: portFinderSync.getPort(8080),
            open: shouldExportScene ? '/?export=1&save=1' : true,
            server: 'http',
            allowedHosts: ['127.0.0.1', 'localhost'],
            headers: devSecurityHeaders,
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
                    if (!shouldExportScene)
                    {
                        res.statusCode = 403
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ ok: false, error: 'Export disabled' }))
                        return
                    }

                    if (req.headers['content-type'] !== 'application/octet-stream')
                    {
                        res.statusCode = 415
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ ok: false, error: 'Unsupported content type' }))
                        return
                    }

                    const chunks = []
                    let totalBytes = 0
                    let aborted = false

                    req.on('end', () =>
                    {
                        if (aborted)
                        {
                            return
                        }

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

                    req.on('data', (chunk) =>
                    {
                        if (aborted)
                        {
                            return
                        }

                        const nextTotal = totalBytes + chunk.length
                        if (nextTotal > MAX_EXPORT_BYTES)
                        {
                            aborted = true
                            res.statusCode = 413
                            res.setHeader('Content-Type', 'application/json')
                            res.end(JSON.stringify({ ok: false, error: 'Payload too large' }))
                            req.destroy()
                            return
                        }

                        totalBytes = nextTotal
                        chunks.push(chunk)
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
            onListening: function(devServer)
            {
                const address = devServer.server.address()
                const port = address && typeof address === 'object' ? address.port : devServer.options.port
                const localIp = getLocalIpAddress()
                const domain1 = `http://${localIp}:${port}`
                const domain2 = `http://localhost:${port}`
                
                console.log(`Project running at:\n  - ${infoColor(domain1)}\n  - ${infoColor(domain2)}`)
            }
        }
    }
)
