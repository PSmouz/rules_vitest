#!/usr/bin/env bash

if [[ "${SPLIT_COVERAGE_POST_PROCESSING:-}" == "1" ]]; then
  cp "${COVERAGE_DIR}/coverage.dat" "${COVERAGE_OUTPUT_FILE}"
fi

exit 0
