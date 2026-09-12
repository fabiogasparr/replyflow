# Assistente de conexão do Instagram

Entrada: **Configurações → Assistente de conexão do Instagram**, em `/settings/instagram`.

## Jornada do cliente

1. **Preparar a conta:** orientação para perfis profissionais Empresa ou Criador, sem confundir conta profissional com selo Meta Verified.
2. **Autorizar acesso:** encaminhamento para o OAuth oficial do Instagram, iniciado apenas por proprietário ou administrador. A senha não é solicitada pelo ReplyFlow. As permissões continuam sendo as já utilizadas pelo aplicativo: perfil, mensagens, comentários e métricas.
3. **Conferir conexão:** seleção de uma conta do espaço ativo, validade prevista do token e inscrição em notificações registradas no banco. Atualizar consulta o banco novamente; não valida o token ao vivo nem testa o webhook.
4. **Primeira automação:** orientação para criar uma automação e executar um teste voluntário com outra conta autorizada para teste. O assistente não ativa campanhas ou envia mensagens automaticamente.

O cliente autoriza a própria conta. A configuração e a análise do aplicativo ReplyFlow para atender contas de terceiros são responsabilidade do operador da plataforma e da Meta. O assistente não solicita análise, não aprova contas e não garante liberação para todos os tenants.

Referências oficiais: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login) e [orientação sobre conta profissional](https://help.instagram.com/502981923235522).

## Segurança e estados

- `GET /api/instagram/onboarding` exige contexto autenticado. Contas e assinatura são consultadas exclusivamente pelo espaço ativo. A resposta não contém tokens, segredos ou nomes de variáveis de ambiente e utiliza `private, no-store`.
- O parâmetro opcional `workspaceId` é uma expectativa, nunca uma autorização para selecionar outro tenant. Se divergir do espaço ativo, a consulta é rejeitada com 409.
- O início do OAuth confere a expectativa de espaço antes de gerar o estado. O destino `wizard` é uma opção fechada no estado assinado, junto de usuário, espaço, nonce e expiração. Não aceita URLs arbitrárias de retorno.
- O callback mantém a validação do cookie iniciador, da assinatura, do usuário, do vínculo e da capacidade transacional. O retorno do wizard identifica a conta realmente persistida e o espaço original. O caminho legado continua retornando ao dashboard.
- Um parâmetro `connected=true` apenas abre a etapa de conferência; não apresenta uma aprovação ou uma conexão sem consultar dados autenticados.
- Conta expirada ou sem validade conhecida pede nova autorização. Uma inscrição em notificações salva é distinta de um evento efetivamente recebido.
- Plano completo não impede reconexão de uma conta existente. A proteção contra adicionar uma nova conta além do limite continua no servidor.
- Falhas de configuração, autorização cancelada, acesso negado e mudança de espaço possuem mensagens orientadas ao cliente. Detalhes arbitrários de erros remotos não são exibidos.

## Impacto, implantação e rollback

Não há nova tabela, migration, dependência ou variável de ambiente. Não muda as permissões solicitadas à Meta, o processamento dos webhooks ou o envio de mensagens. O campo opcional de retorno mantém compatibilidade com tentativas OAuth legadas.

Para reverter esta funcionalidade, reverta o commit do onboarding e implante novamente o código anterior. Contas e tokens existentes permanecem no banco. Não apague contas, tabelas ou segredos. Novas tentativas voltarão ao fluxo antigo de conexão.

## Validação e limites

Testes automatizados cobrem isolamento da consulta, sessão ausente, papel de membro, mudança de espaço, indisponibilidade de banco, estados de validade, retorno assinado do wizard, cookie seguro, cancelamento, compatibilidade do callback antigo e renderização inicial sem falsa confirmação.

A renderização estática não substitui teste interativo em navegador. Antes de liberar para clientes externos, validar em homologação HTTPS:

1. Iniciar com proprietário e administrador; comprovar bloqueio com membro.
2. Autorizar pela Meta, retornar ao mesmo espaço e conferir a conta recebida.
3. Cancelar e repetir; testar troca de espaço em outra aba e tentativa expirada.
4. Renovar uma conta no limite do plano; comprovar recusa de nova conta além do limite.
5. Testar seleção de contas, teclado, foco, tela pequena, carregamento e falha de rede.
6. Com conta de teste aprovada para uso do aplicativo, executar comentário real, recebimento do webhook, processamento do worker e entrega da resposta no Instagram.
7. Conferir acessos e análise necessários para contas externas no painel da Meta; não inferir aprovação pela presença de variáveis de ambiente.

O endereço público de teste, a validação interativa e o teste real com a Meta permanecem pendentes enquanto a infraestrutura de homologação não estiver disponível. Ver também [implantação de homologação](STAGING_INSTAGRAM.md) e [análise do aplicativo](META_APP_REVIEW.md).
