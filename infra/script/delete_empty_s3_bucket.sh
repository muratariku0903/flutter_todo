#!/bin/bash

# 空のS3バケットをリストアップ
empty_buckets=($(aws s3 ls | awk '{print $3}' | while read -r bucket; do
  if [ -z "$(aws s3 ls "s3://$bucket")" ]; then
    echo $bucket
  fi
done))

# 空のバケットを削除
for bucket in "${empty_buckets[@]}"; do
  echo "Deleting bucket: $bucket"
  aws s3 rb "s3://$bucket"
done
