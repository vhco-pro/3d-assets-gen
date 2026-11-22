load helper

setup() { setup_stubs; }

@test "a version without a release record fails" {
  export STUB_RELEASE_JSON=""
  run "$DEPLOY/check-image.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"no GitHub Release record for v1.2.3"* ]]
}

@test "a package that cannot be pulled anonymously fails before any other check" {
  export STUB_PULL_EXIT=1
  run "$DEPLOY/check-image.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"anonymous pull of sha256:abc failed; is the package public?"* ]]
  [ "$(call_line 'cosign verify')" = "" ]
}
