package com.alsmanu.multibrowser.mail

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

@Serializable data class Domain(val domain: String)
@Serializable data class DomainList(@SerialName("hydra:member") val items: List<Domain> = emptyList())
@Serializable data class AccountRequest(val address: String, val password: String)
@Serializable data class Account(val id: String, val address: String)
@Serializable data class TokenRequest(val address: String, val password: String)
@Serializable data class TokenResponse(val token: String)
@Serializable data class Sender(val address: String, val name: String = "")
@Serializable data class MailMessage(val id: String, val from: Sender, val subject: String = "", val intro: String = "", val createdAt: String = "")
@Serializable data class MessageList(@SerialName("hydra:member") val items: List<MailMessage> = emptyList())
@Serializable data class MessageDetail(val id: String, val from: Sender, val subject: String = "", val text: String = "", val html: List<String> = emptyList())
@Serializable data class MailIdentity(val accountId: String, val address: String, val password: String, val token: String)

class MailClient(context: Context) {
    private val jsonCodec = Json { ignoreUnknownKeys = true }
    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(jsonCodec) }
    }
    private val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    private val secrets = EncryptedSharedPreferences.create(
        context,
        "mail_secrets",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saved(panelId: String): MailIdentity? = secrets.getString(panelId, null)?.let {
        runCatching { jsonCodec.decodeFromString<MailIdentity>(it) }.getOrNull()
    }

    private fun save(panelId: String, identity: MailIdentity) {
        secrets.edit().putString(panelId, jsonCodec.encodeToString(MailIdentity.serializer(), identity)).apply()
    }

    suspend fun create(panelId: String): MailIdentity {
        val domain = client.get("https://api.mail.tm/domains").body<DomainList>().items.first().domain
        val address = "mb-${UUID.randomUUID().toString().take(10)}@$domain"
        val password = UUID.randomUUID().toString() + UUID.randomUUID().toString()
        val account = client.post("https://api.mail.tm/accounts") {
            contentType(ContentType.Application.Json); setBody(AccountRequest(address, password))
        }.body<Account>()
        val token = client.post("https://api.mail.tm/token") {
            contentType(ContentType.Application.Json); setBody(TokenRequest(address, password))
        }.body<TokenResponse>().token
        return MailIdentity(account.id, address, password, token).also { save(panelId, it) }
    }

    suspend fun messages(identity: MailIdentity): List<MailMessage> = client.get("https://api.mail.tm/messages") {
        header(HttpHeaders.Authorization, "Bearer ${identity.token}")
    }.body<MessageList>().items

    suspend fun message(identity: MailIdentity, id: String): MessageDetail = client.get("https://api.mail.tm/messages/$id") {
        header(HttpHeaders.Authorization, "Bearer ${identity.token}")
    }.body()

    suspend fun delete(panelId: String, identity: MailIdentity?) {
        if (identity != null) runCatching {
            client.delete("https://api.mail.tm/accounts/${identity.accountId}") {
                header(HttpHeaders.Authorization, "Bearer ${identity.token}")
            }
        }
        secrets.edit().remove(panelId).apply()
    }
}
