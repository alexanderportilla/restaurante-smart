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
        UV_CACHE_DIR = "${WORKSPACE}/.cache/uv"
        npm_config_cache = "${WORKSPACE}/.cache/npm"
    }

    stages {
        stage('1. Checkout') {
            steps {
                script {
                    if (!fileExists('sonar-project.properties')) {
                        checkout([
                            $class: 'GitSCM',
                            branches: [[name: '*/main']],
                            doGenerateSubmoduleConfigurations: false,
                            userRemoteConfigs: [[url: '/workspace/restaurante-smart']]
                        ])
                    }
                    sh '''
                        git config --global --add safe.directory /workspace/restaurante-smart || true
                        echo "=== SCM Info ==="
                        git rev-parse --abbrev-ref HEAD
                        git rev-parse --short HEAD
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
                    withCredentials([string(credentialsId: 'sonarqube-token', variable: 'SONAR_TOKEN')]) {
                        sh '''
                            set -eu
                            sonar-scanner \
                                -Dsonar.host.url="${SONAR_HOST_URL}" \
                                -Dsonar.token="${SONAR_TOKEN}"
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

        stage('13. Validación Dockerfiles (Build Sin Socket Pendiente)') {
            steps {
                sh '''
                    set -eu
                    echo "=== Validación estática de artefactos Docker (sin acceso a docker.sock) ==="
                    for file in backend/Dockerfile frontend/Dockerfile frontend/nginx.conf .dockerignore docker-compose.yml; do
                        test -f "${file}"
                        echo "OK: ${file} presente"
                    done

                    echo "[PENDIENTE - OPCIÓN B] Construcción de imágenes omitida en pipeline:"
                    echo "  - Seguridad: no se monta /var/run/docker.sock ni se conceden privilegios rootless/seccomp relajados."
                    echo "  - Alternativa futura recomendada: servicio buildkitd rootless aislado o runner externo dedicado."
                '''
            }
        }

        stage('14. Resumen y Publicación') {
            steps {
                sh '''
                    set -eu
                    echo "=== Artefactos generados en workspace ==="
                    ls -lh backend/coverage.xml backend/test-results/pytest-junit.xml
                    ls -lh frontend/coverage/lcov.info frontend/test-results/vitest-junit.xml
                    ls -ld frontend/dist
                '''
            }
        }
    }

    post {
        always {
            junit allowEmptyResults: true, testResults: 'backend/test-results/pytest-junit.xml,frontend/test-results/vitest-junit.xml'
            archiveArtifacts artifacts: 'backend/coverage.xml,backend/test-results/*.xml,frontend/coverage/lcov.info,frontend/test-results/*.xml', fingerprint: true, allowEmptyArchive: true
        }
        success {
            echo 'Pipeline CI/CD Restaurante Smart completado satisfactoriamente (Quality Gate PASSED).'
        }
        failure {
            echo 'Pipeline CI/CD Restaurante Smart falló. Revisar logs, pruebas o Quality Gate en SonarQube.'
        }
    }
}
