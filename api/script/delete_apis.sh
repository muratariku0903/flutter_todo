#!/bin/bash

# 削除したいAPI名のリスト
API_NAMES=("api-sampleApi1-develop" "api-sampleApi2-develop")

# 各API名に対して処理を行う
# apiの呼び出しが結構失敗するので再試行回数をaws-configにて多めに設定する必要がある（デフォルトでは2回となっている）
for API_NAME in "${API_NAMES[@]}"; do
  echo "Deleting APIs with name: $API_NAME"

  # 同じ名前のAPIのIDを取得する
  api_ids=$(aws apigateway get-rest-apis | jq -r --arg API_NAME "$API_NAME" '.items[] | select(.name==$API_NAME) | .id')

  # 各API IDに対して削除を実行する
  for api_id in $api_ids; do
    aws apigateway delete-rest-api --rest-api-id $api_id
    sleep 1
    if [ $? -eq 0 ]; then
      echo "Deleted API with ID: $api_id"
    else
      echo "Failed to delete API with ID: $api_id"
    fi
  done
done
