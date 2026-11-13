# @thinkiac/module-env

Carrega o `.env` de cada pacote durante o boot. Variáveis já definidas pelo processo têm precedência; cada valor também fica disponível como `<PACOTE>_ENV_<CHAVE>`.
