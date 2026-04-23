class CustomReporter {
  onFinished(files, errors) {
    if (errors.length) {
      console.error(`custom reporter observed ${errors.length} error(s)`)
    } else {
      console.log(`custom reporter observed ${files.length} file(s)`)
    }
  }
}

module.exports = CustomReporter
