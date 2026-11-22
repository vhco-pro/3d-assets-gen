load helper

# The actionlint step of scripts/verify.sh, run on its own through scripts/ci/actionlint.sh with the pinned
# binary from tools.env (AC-24). These tests download the real pinned binary into the tool cache.
setup() {
  ROOT="$BATS_TEST_DIRNAME/../../.."
  FIX="$BATS_TEST_TMPDIR/workflows"
  mkdir -p "$FIX"
}

@test "a workflow with an error fails the actionlint step" {
  printf 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ github.nope.value }}\n        shell: bash\n        timeout: 3\n' > "$FIX/bad.yml"
  run "$ROOT/scripts/ci/actionlint.sh" "$FIX"
  [ "$status" -ne 0 ]
}

@test "the repository's workflows pass the actionlint step" {
  run "$ROOT/scripts/ci/actionlint.sh" "$ROOT/.github/workflows"
  [ "$status" -eq 0 ]
}
