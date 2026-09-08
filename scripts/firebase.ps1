$cliPath = Join-Path $PSScriptRoot '../node_modules/firebase-tools/lib/bin/firebase.js'
& node $cliPath @args
exit $LASTEXITCODE
