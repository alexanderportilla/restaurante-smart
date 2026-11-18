pipeline {
    agent {
        label 'restaurante-smart-agent'
    }

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        PROJECT_NAME = 'restaurante-smart'
        APP_ENV = 'test'
        PYTHONUNBUFFERED = '1'
        UV_LINK_MODE = 'copy'
        UV_CACHE_DIR = '/home/jenkins/agent/.cache/uv'
        npm_config_cache = '/home/jenkins/agent/.cache/npm'
    }

    stages {
        stage('1. Checkout') {
            steps {
                script {
                    if (env.GIT_URL) {
                        checkout scm
                    } else {
                        deleteDir()
                        checkout([
                            $class: 'GitSCM',
                            branches: [[name: '*/main']],
                            doGenerateSubmoduleConfigurations: false,
                            extensions: [[$class: 'CleanBeforeCheckout']],
                            userRemoteConfigs: [[url: '/workspace/restaurante-smart']]
                        ])
                    }
                    sh '''
                        set -eu
                        if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq '/workspace/restaurante-smart'; then
                            git config --global --add safe.directory /workspace/restaurante-smart || true
                        fi
                        test -f sonar-project.properties
                        echo "=== SCM Info ==="
                        git rev-parse --abbrev-ref HEAD
                        git rev-parse HEAD
                        git log -1 --oneline
                        git status --short
                    '''
                }
            }
        }

        stage('2. Verificación de Herramientas y Aislamiento') {
            steps {
                sh '''
                    set -eu
                    echo "=== Usuario y entorno del agente ==="
                    id
                    test ! -S /var/run/docker.sock
                    echo "OK: /var/run/docker.sock no presente (Opción B)"

                    echo "=== Versiones de toolchain ==="
                    java -version
                    git --version
                    python3 --version
                    uv --version
                    node --version
                    npm --version
                    sonar-scanner --version
                '''
            }
        }

        stage('3. Preparación Backend') {
            steps {
                dir('backend') {
                    sh 'uv sync --frozen --group dev'
                }
            }
        }

        stage('4. Lint Backend (Ruff)') {
            steps {
                dir('backend') {
                    sh 'uv run --no-sync ruff check app tests migrations'
                }
            }
        }

        stage('5. Pruebas Backend y Cobertura') {
            steps {
                dir('backend') {
                    sh '''
                        set -eu
                        mkdir -p test-results
                        uv run --no-sync pytest \
                            --cov=app \
                            --cov-report=xml:coverage.xml \
                            --cov-report=term-missing \
                            --junitxml=test-results/pytest-junit.xml
                    '''
                }
            }
        }

        stage('6. Preparación Frontend') {
            steps {
                dir('frontend') {
                    sh 'npm ci --no-audit --no-fund'
                }
            }
        }

        stage('7. Lint Frontend (ESLint)') {
            steps {
                dir('frontend') {
                    sh 'npm run lint'
                }
            }
        }

        stage('8. Typecheck Frontend (TypeScript)') {
            steps {
                dir('frontend') {
                    sh 'npm run typecheck'
                }
            }
        }

        stage('9. Pruebas Frontend y Cobertura') {
            steps {
                dir('frontend') {
                    sh '''
                        set -eu
                        mkdir -p test-results
                        npx vitest run \
                            --coverage \
                            --reporter=default \
                            --reporter=junit \
                            --outputFile.junit=test-results/vitest-junit.xml
                    '''
                }
            }
        }

        stage('10. Build Frontend (Vite)') {
            steps {
                dir('frontend') {
                    sh 'npm run build'
                }
            }
        }

        stage('11. Análisis SonarQube') {
            steps {
                withSonarQubeEnv('sonarqube-local') {
                    withCredentials([
                        string(
                            credentialsId: 'sonarqube-token',
                            variable: 'SONAR_TOKEN'
                        )
                    ]) {
                        sh '''
                            set -eu
                            sonar-scanner \
                                -Dsonar.host.url="${SONAR_HOST_URL}"
                        '''
                    }
                }
            }
        }

        stage('12. Quality Gate') {
            steps {
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('13. Validación Dockerfiles') {
            steps {
                sh '''
                    set -eu
                    echo "=== Validación estática de artefactos Docker y arquitectura OCI ==="
                    for file in backend/Dockerfile frontend/Dockerfile frontend/nginx.conf .dockerignore docker-compose.yml; do
                        test -f "${file}"
                        echo "OK: ${file} presente"
                    done
                '''
            }
        }

        stage('14. Resumen y Publicación de Artefactos de Calidad') {
            steps {
                sh '''
                    set -eu
                    echo "=== Artefactos de calidad generados en workspace ==="
                    ls -lh backend/coverage.xml backend/test-results/pytest-junit.xml
                    ls -lh frontend/coverage/lcov.info frontend/test-results/vitest-junit.xml
                    ls -ld frontend/dist
                '''
            }
        }

        stage('15. Construcción OCI (Kaniko)') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'registry-builder-credentials',
                        usernameVariable: 'REG_BUILDER_USER',
                        passwordVariable: 'REG_BUILDER_PASS'
                    )
                ]) {
                    sh '''
                        set -eu
                        echo "=== Construcción OCI aislada con Kaniko (sin socket Docker) ==="
                        COMMIT_SHORT=$(git rev-parse --short=7 HEAD)
                        IMAGE_TAG="staging-${COMMIT_SHORT}"
                        echo "Compilando Backend OCI con Kaniko (Tag inmutable: ${IMAGE_TAG})..."
                        
                        BACKEND_RES=$(curl -s -f -u "${REG_BUILDER_USER}:${REG_BUILDER_PASS}" \
                            -H "Content-Type: application/json" \
                            -d "{\\"service\\": \\"backend\\", \\"commit\\": \\"${COMMIT_SHORT}\\", \\"tag\\": \\"${IMAGE_TAG}\\"}" \
                            http://172.19.0.1:8089/build)
                        
                        echo "${BACKEND_RES}" > backend-build.json
                        echo "Backend OCI compilado exitosamente."

                        echo "Compilando Frontend OCI con Kaniko (Tag inmutable: ${IMAGE_TAG})..."
                        FRONTEND_RES=$(curl -s -f -u "${REG_BUILDER_USER}:${REG_BUILDER_PASS}" \
                            -H "Content-Type: application/json" \
                            -d "{\\"service\\": \\"frontend\\", \\"commit\\": \\"${COMMIT_SHORT}\\", \\"tag\\": \\"${IMAGE_TAG}\\"}" \
                            http://172.19.0.1:8089/build)
                        
                        echo "${FRONTEND_RES}" > frontend-build.json
                        echo "Frontend OCI compilado exitosamente."
                    '''
                }
            }
        }

        stage('16. Publicación en Registro Privado') {
            steps {
                sh '''
                    set -eu
                    echo "=== Verificación de publicación y extracción de OCI Digests ==="
                    BACKEND_DIGEST=$(python3 -c "import json; print(json.load(open('backend-build.json'))['digest'])")
                    FRONTEND_DIGEST=$(python3 -c "import json; print(json.load(open('frontend-build.json'))['digest'])")
                    COMMIT_SHORT=$(git rev-parse --short=7 HEAD)
                    IMAGE_TAG="staging-${COMMIT_SHORT}"
                    
                    test -n "${BACKEND_DIGEST}"
                    test -n "${FRONTEND_DIGEST}"
                    
                    echo "Artefacto Backend publicado en registro privado:"
                    echo "  - Imagen: registry.devops.local:5000/restaurante-smart-backend:${IMAGE_TAG}"
                    echo "  - Digest: ${BACKEND_DIGEST}"
                    
                    echo "Artefacto Frontend publicado en registro privado:"
                    echo "  - Imagen: registry.devops.local:5000/restaurante-smart-frontend:${IMAGE_TAG}"
                    echo "  - Digest: ${FRONTEND_DIGEST}"
                    
                    python3 -c "
import json
meta = {
    'commit': '${COMMIT_SHORT}',
    'build_number': '${BUILD_NUMBER}',
    'tag': '${IMAGE_TAG}',
    'backend_image': 'registry.devops.local:5000/restaurante-smart-backend:${IMAGE_TAG}',
    'backend_digest': '${BACKEND_DIGEST}',
    'frontend_image': 'registry.devops.local:5000/restaurante-smart-frontend:${IMAGE_TAG}',
    'frontend_digest': '${FRONTEND_DIGEST}'
}
with open('build-metadata.json', 'w') as f:
    json.dump(meta, f, indent=2)
"
                '''
            }
        }

        stage('17. Despliegue Staging (Deployer)') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'staging-deployer-token',
                        variable: 'DEPLOYER_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu
                        COMMIT_SHORT=$(git rev-parse --short=7 HEAD)
                        IMAGE_TAG="staging-${COMMIT_SHORT}"
                        echo "=== Solicitando despliegue controlado a staging (Tag: ${IMAGE_TAG}) ==="
                        
                        DEPLOY_RES=$(curl -s -f -X POST \
                            -H "Authorization: Bearer ${DEPLOYER_TOKEN}" \
                            -H "Content-Type: application/json" \
                            -d "{\\"action\\": \\"deploy-staging\\", \\"service\\": \\"all\\", \\"image_tag\\": \\"${IMAGE_TAG}\\"}" \
                            http://172.19.0.1:8088/deploy)
                        
                        echo "${DEPLOY_RES}" > deploy-result.json
                        python3 -c "
import json, sys
res = json.load(open('deploy-result.json'))
if res.get('status') != 'success':
    print('Error en despliegue:', res)
    sys.exit(1)
print('Despliegue confirmado por Deployer:', res.get('message'))
"
                    '''
                }
            }
        }

        stage('18. Pruebas de Humo Staging') {
            steps {
                sh '''
                    set -eu
                    echo "=== Ejecución de pruebas de humo sobre Staging ==="
                    
                    echo "1. Comprobando servicio Deployer y Podman socket..."
                    curl -s -f http://172.19.0.1:8088/health | python3 -c "import sys, json; data = json.load(sys.stdin); assert data.get('status') == 'ok' and data.get('podman_socket') == 'ok'"
                    echo "  [PASS] Deployer y Podman Rootless socket operativos."
                    
                    echo "2. Comprobando API Backend Staging (GET /api/v1/health)..."
                    curl -s -f http://172.19.0.1:8002/api/v1/health | python3 -c "import sys, json; data = json.load(sys.stdin); assert data.get('status') == 'ok' and data.get('database') == 'connected'"
                    echo "  [PASS] Backend saludable y conectado a PostgreSQL 17 Staging."
                    
                    echo "3. Comprobando especificación OpenAPI (GET /api/v1/openapi.json)..."
                    curl -s -f http://172.19.0.1:8002/api/v1/openapi.json | python3 -c "import sys, json; data = json.load(sys.stdin); assert data.get('openapi', '').startswith('3.') and 'Restaurante Smart' in data.get('info', {}).get('title', '')"
                    echo "  [PASS] Esquema OpenAPI 3.1.0 válido servido por Backend."
                    
                    echo "4. Comprobando Frontend Staging (GET /)..."
                    curl -s -f http://172.19.0.1:3002/ | grep -q 'id="root"'
                    echo "  [PASS] Frontend SPA React servido correctamente."
                    
                    echo "5. Comprobando enrutamiento proxy Nginx (GET /api/v1/health desde frontend)..."
                    curl -s -f http://172.19.0.1:3002/api/v1/health | python3 -c "import sys, json; data = json.load(sys.stdin); assert data.get('status') == 'ok' and data.get('database') == 'connected'"
                    echo "  [PASS] Proxy Nginx redirige exitosamente tráfico API al Backend interno."
                '''
            }
        }

        stage('19. Registro y Archivo de Evidencias') {
            steps {
                sh '''
                    set -eu
                    echo "=== Consolidando evidencias finales de entrega continua ==="
                    python3 -c "
import json, datetime
meta = json.load(open('build-metadata.json'))
deploy = json.load(open('deploy-result.json'))
evidence = {
    'project': 'restaurante-smart',
    'pipeline': 'CI/CD Full Lifecycle',
    'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'commit': meta['commit'],
    'jenkins_build': '${BUILD_NUMBER}',
    'image_tag': meta['tag'],
    'artifacts': {
        'backend': {
            'image': meta['backend_image'],
            'digest': meta['backend_digest']
        },
        'frontend': {
            'image': meta['frontend_image'],
            'digest': meta['frontend_digest']
        }
    },
    'staging_deployment': {
        'status': deploy.get('status'),
        'database': deploy.get('database'),
        'backend': deploy.get('backend'),
        'frontend': deploy.get('frontend'),
        'migrations': deploy.get('migrations')
    },
    'smoke_tests': {
        'backend_health': 'PASS',
        'openapi_spec': 'PASS',
        'frontend_spa': 'PASS',
        'nginx_api_proxy': 'PASS',
        'podman_socket': 'PASS'
    }
}
with open('deployment-evidence.json', 'w') as f:
    json.dump(evidence, f, indent=2)
print(json.dumps(evidence, indent=2))
"
                '''
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'backend/test-results/pytest-junit.xml,frontend/test-results/vitest-junit.xml'
            archiveArtifacts artifacts: 'backend/coverage.xml,backend/test-results/*.xml,frontend/coverage/lcov.info,frontend/test-results/*.xml,build-metadata.json,deploy-result.json,deployment-evidence.json', fingerprint: true, allowEmptyArchive: true
        }
        success {
            echo 'Pipeline CI/CD Restaurante Smart completado satisfactoriamente (Quality Gate PASSED y Despliegue Exitoso).'
        }
        failure {
            echo 'Pipeline CI/CD Restaurante Smart falló. Revisar logs, pruebas, Quality Gate o despliegue Staging.'
        }
    }
}
