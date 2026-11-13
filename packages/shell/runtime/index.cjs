// A descoberta de pacotes do runtime varre o Shell inteiro. Este ponto de
// entrada documenta que o catálogo e os recursos do host pertencem ao Shell.
module.exports = {
  ...require('./system/apps/routes'),
  ...require('./system/apps/hooks'),
};
