import dynamic from 'next/dynamic'
import 'swagger-ui-react/swagger-ui.css'

const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false })

export default function ApiExplorer() {
  return (
    <div style={{ marginTop: '1rem' }}>
      <SwaggerUI
        url="/openapi.yaml"
        deepLinking={true}
        defaultModelsExpandDepth={1}
        docExpansion="list"
        tryItOutEnabled={true}
      />
    </div>
  )
}
